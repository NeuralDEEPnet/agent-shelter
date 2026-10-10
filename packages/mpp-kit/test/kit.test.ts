import { test } from "node:test";
import assert from "node:assert/strict";
import { Mppx as ClientMppx, stripe as clientStripe } from "mppx/client";
import {
  assertMachinePrices,
  centsToAmount,
  createChallengeLimiter,
  createMachinePayments,
  hashToken,
  mintToken,
  resolveMppConfig,
  type MachineProduct,
  type PaymentRecord,
  type PaymentStore,
  type StripeLikeClient,
} from "../src/index.ts";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fakeStripe(sequence: () => { id: string; replayed?: boolean }): StripeLikeClient & {
  calls: unknown[];
} {
  const calls: unknown[] = [];
  return {
    calls,
    paymentIntents: {
      create: async (params, options) => {
        calls.push({ params, options });
        const next = sequence();
        const headers: Record<string, string> = next.replayed
          ? { "idempotent-replayed": "true" }
          : {};
        return { id: next.id, status: "succeeded", lastResponse: { headers } };
      },
    },
  };
}

function memoryStore(): PaymentStore & { rows: PaymentRecord[] } {
  const rows: PaymentRecord[] = [];
  return {
    rows,
    async record(payment) {
      if (rows.some((r) => r.reference === payment.reference)) return "duplicate";
      rows.push(payment);
      return "created";
    },
  };
}

const LIVE_ENV = {
  STRIPE_RESTRICTED_KEY: "rk_live_unitkey_000000000000000000000",
  STRIPE_PROFILE_ID: "profile_unit_test",
};

const IMAGE: MachineProduct = {
  id: "image_1",
  amountCents: 50,
  description: "One render",
};

/** Drives the real mppx client against an in-process handler. */
function agent(serve: (req: Request) => Promise<Response>, spt = "spt_test_1") {
  return ClientMppx.create({
    methods: [
      clientStripe.charge({
        paymentMethod: "pm_card_visa",
        createToken: async () => spt,
      }),
    ],
    fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
      serve(input instanceof Request ? input : new Request(input, init)),
  });
}

// ─── config ───────────────────────────────────────────────────────────────────

test("config: unset → unconfigured with a reason, never a guess", () => {
  const c = resolveMppConfig({});
  assert.equal(c.configured, false);
  if (!c.configured) assert.match(c.reason, /not set/);
});

test("config: a full secret key is refused", () => {
  const c = resolveMppConfig({
    STRIPE_RESTRICTED_KEY: "sk_live_abc",
    STRIPE_PROFILE_ID: "profile_x",
  });
  assert.equal(c.configured, false);
  if (!c.configured) assert.match(c.reason, /restricted key/);
});

test("config: live wins over sandbox unless MPP_MODE says otherwise", () => {
  const both = {
    ...LIVE_ENV,
    STRIPE_SANDBOX_KEY: "rk_test_sandbox_key",
    STRIPE_SANDBOX_PROFILE_ID: "profile_test_x",
  };
  const auto = resolveMppConfig(both);
  assert.equal(auto.configured && auto.mode, "live");
  assert.equal(auto.configured && auto.livemode, true);
  const sandbox = resolveMppConfig({ ...both, MPP_MODE: "sandbox" });
  assert.equal(sandbox.configured && sandbox.mode, "sandbox");
  assert.equal(sandbox.configured && sandbox.livemode, false);
  const onlySandbox = resolveMppConfig({
    STRIPE_SANDBOX_KEY: "rk_test_sandbox_key",
    STRIPE_SANDBOX_PROFILE_ID: "profile_test_x",
  });
  assert.equal(onlySandbox.configured && onlySandbox.mode, "sandbox");
});

// ─── prices ───────────────────────────────────────────────────────────────────

test("prices: below the 50c card floor fails at load, formatting is exact", () => {
  assert.throws(() =>
    assertMachinePrices({ bad: { id: "bad", amountCents: 5, description: "x" } }),
  );
  assert.throws(() =>
    assertMachinePrices({ bad: { id: "bad", amountCents: 50.5, description: "x" } }),
  );
  assert.doesNotThrow(() => assertMachinePrices({ ok: IMAGE }));
  assert.equal(centsToAmount(50), "0.50");
  assert.equal(centsToAmount(150), "1.50");
  assert.equal(centsToAmount(1200), "12.00");
});

// ─── lifecycle ────────────────────────────────────────────────────────────────

test("unconfigured: charge() answers 503 problem+json and never touches Stripe", async () => {
  const store = memoryStore();
  const mp = createMachinePayments({
    config: resolveMppConfig({}),
    realm: "test.local",
    store,
  });
  assert.equal(mp.configured, false);
  assert.equal(mp.health().state, "unconfigured");
  const out = await mp.charge(
    { product: IMAGE, scope: "/api/mpp/generate" },
    new Request("http://t/api/mpp/generate", { method: "POST", body: "{}" }),
  );
  assert.equal(out.kind, "unconfigured");
  if (out.kind === "unconfigured") {
    assert.equal(out.response.status, 503);
    assert.equal(
      out.response.headers.get("content-type"),
      "application/problem+json",
    );
  }
  assert.equal(store.rows.length, 0);
});

test("lifecycle: unpaid → 402 challenge; paid → PaymentIntent created, receipt returned, store has one row", async () => {
  const store = memoryStore();
  let n = 0;
  const stripeClient = fakeStripe(() => ({ id: `pi_${++n}` }));
  const events: string[] = [];
  const mp = createMachinePayments({
    config: resolveMppConfig(LIVE_ENV),
    realm: "test.local",
    store,
    stripeClient,
    onEvent: (e) => events.push(e.kind),
  });
  assert.equal(mp.health().state, "ready");
  assert.equal(mp.health().key, "rk_live_…0000");

  const serve = async (request: Request) => {
    const out = await mp.charge(
      { product: IMAGE, scope: "/api/mpp/generate", meta: { v: "1" } },
      request,
    );
    if (out.kind !== "paid") return out.response;
    return out.respond(Response.json({ jobId: "job_1", paid: out.reference }));
  };

  // Unpaid probe.
  const first = await serve(
    new Request("http://t/api/mpp/generate", { method: "POST", body: "{}" }),
  );
  assert.equal(first.status, 402);
  const www = first.headers.get("www-authenticate") ?? "";
  assert.match(www, /^Payment /);
  assert.match(www, /method="stripe"/);
  assert.match(www, /realm="test.local"/);
  // amount is in the base64url `request` param — decode and check 50 cents EUR
  const reqParam = /request="([^"]+)"/.exec(www)?.[1] ?? "";
  const decoded = JSON.parse(Buffer.from(reqParam, "base64url").toString());
  assert.equal(decoded.amount, "50");
  assert.equal(decoded.currency, "eur");
  assert.equal(decoded.methodDetails.networkId, "profile_unit_test");
  assert.equal(stripeClient.calls.length, 0);
  assert.equal(store.rows.length, 0);

  // The agent pays and retries.
  const paid = await agent(serve).fetch("http://t/api/mpp/generate", {
    method: "POST",
    body: JSON.stringify({ prompt: "a chair" }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(paid.status, 200);
  const body = await paid.json();
  assert.equal(body.jobId, "job_1");
  assert.equal(body.paid, "pi_1");
  assert.ok(paid.headers.get("payment-receipt"));
  assert.equal(stripeClient.calls.length, 1);
  const call = stripeClient.calls[0] as {
    params: Record<string, unknown>;
    options: Record<string, unknown>;
  };
  assert.equal(call.params.amount, 50);
  assert.equal(call.params.currency, "eur");
  assert.equal(call.params.confirm, true);
  assert.equal(call.params.shared_payment_granted_token, "spt_test_1");
  assert.match(String(call.options.idempotencyKey), /^mpp_.*_spt_test_1$/);

  assert.equal(store.rows.length, 1);
  assert.deepEqual(
    { ...store.rows[0], meta: store.rows[0]?.meta },
    {
      reference: "pi_1",
      product: "image_1",
      amountCents: 50,
      currency: "eur",
      scope: "/api/mpp/generate",
      livemode: true,
      meta: { v: "1" },
    },
  );
  // One probe + the agent's own unpaid first request → two challenges, then one payment.
  assert.deepEqual(events, ["challenge", "challenge", "paid"]);
});

test("idempotency: a replayed credential is a 402 (Stripe replay) and a re-seen reference is a 409 (our store)", async () => {
  const store = memoryStore();
  let replay = false;
  const stripeClient = fakeStripe(() => ({ id: "pi_same", replayed: replay }));
  const mp = createMachinePayments({
    config: resolveMppConfig(LIVE_ENV),
    realm: "test.local",
    store,
    stripeClient,
  });

  let credential: string | null = null;
  const serve = async (request: Request) => {
    if (request.headers.get("authorization")) {
      credential = request.headers.get("authorization");
    }
    const out = await mp.charge({ product: IMAGE, scope: "/s" }, request);
    if (out.kind !== "paid") return out.response;
    return out.respond(Response.json({ ok: true }));
  };

  const ok = await agent(serve).fetch("http://t/s", { method: "POST", body: "{}" });
  assert.equal(ok.status, 200);
  assert.ok(credential);

  // 1) Stripe says this idempotency key was already used → mppx refuses → 402.
  replay = true;
  const replayed = await serve(
    new Request("http://t/s", {
      method: "POST",
      body: "{}",
      headers: { authorization: credential! },
    }),
  );
  assert.equal(replayed.status, 402);
  assert.match(await replayed.text(), /already been processed/);
  assert.equal(store.rows.length, 1);

  // 2) Even if Stripe did NOT flag the replay, the same reference cannot be
  //    redeemed twice on our side.
  replay = false;
  const dup = await serve(
    new Request("http://t/s", {
      method: "POST",
      body: "{}",
      headers: { authorization: credential! },
    }),
  );
  assert.equal(dup.status, 409);
  const problem = await dup.json();
  assert.equal(problem.reference, "pi_same");
  assert.equal(store.rows.length, 1);
});

test("binding: a credential paid for one route/amount is refused on another", async () => {
  const store = memoryStore();
  let n = 0;
  const stripeClient = fakeStripe(() => ({ id: `pi_${++n}` }));
  const mp = createMachinePayments({
    config: resolveMppConfig(LIVE_ENV),
    realm: "test.local",
    store,
    stripeClient,
  });
  let credential: string | null = null;
  const cheap = async (request: Request) => {
    if (request.headers.get("authorization")) {
      credential = request.headers.get("authorization");
    }
    const out = await mp.charge({ product: IMAGE, scope: "/cheap" }, request);
    return out.kind === "paid" ? out.respond(Response.json({})) : out.response;
  };
  assert.equal((await agent(cheap).fetch("http://t/cheap", { method: "POST", body: "{}" })).status, 200);

  const four: MachineProduct = { id: "image_4", amountCents: 150, description: "Four" };
  const dear = await mp.charge(
    { product: four, scope: "/cheap" },
    new Request("http://t/cheap", { method: "POST", body: "{}", headers: { authorization: credential! } }),
  );
  assert.equal(dear.kind, "challenge");
  if (dear.kind === "challenge") assert.equal(dear.response.status, 402);

  const elsewhere = await mp.charge(
    { product: IMAGE, scope: "/other" },
    new Request("http://t/other", { method: "POST", body: "{}", headers: { authorization: credential! } }),
  );
  assert.equal(elsewhere.kind, "challenge");
  // Only the legitimate payment ever reached the store.
  assert.equal(store.rows.length, 1);
  assert.equal(stripeClient.calls.length, 1);
});

test("request body survives the 402 lifecycle (the app validates the SAME body it later delivers against)", async () => {
  const mp = createMachinePayments({
    config: resolveMppConfig(LIVE_ENV),
    realm: "t",
    store: memoryStore(),
    stripeClient: fakeStripe(() => ({ id: "pi_b" })),
  });
  const req = new Request("http://t/s", { method: "POST", body: '{"prompt":"x"}' });
  const out = await mp.charge({ product: IMAGE, scope: "/s" }, req);
  assert.equal(out.kind, "challenge");
  assert.deepEqual(await req.json(), { prompt: "x" });
});

// ─── limiter + tokens ─────────────────────────────────────────────────────────

test("challenge limiter: allows `max` hits per window, then reports seconds to wait", () => {
  const limiter = createChallengeLimiter({ max: 3, windowMs: 60_000 });
  const t0 = 1_000_000;
  assert.equal(limiter.hit("a", t0), null);
  assert.equal(limiter.hit("a", t0 + 1), null);
  assert.equal(limiter.hit("a", t0 + 2), null);
  const wait = limiter.hit("a", t0 + 3);
  assert.ok(wait !== null && wait >= 59 && wait <= 60);
  assert.equal(limiter.hit("b", t0 + 3), null, "other keys unaffected");
  assert.equal(limiter.hit("a", t0 + 60_001), null, "window slid");
});

test("tokens: plaintext once, hash stored, prefix visible", () => {
  const { token, hash } = mintToken("smj");
  assert.match(token, /^smj_[A-Za-z0-9_-]{43}$/);
  assert.equal(hash, hashToken(token));
  assert.notEqual(mintToken("smj").token, token);
});
