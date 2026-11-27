import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { serialize } from "superjson";

process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_test_local";
process.env.SHELTER_OWNER_HANDLES ||= "neuraldeepnet";
process.env.SHELTER_CLEAN_APPROVAL = "false";

const { isOwnProcedure, isValidProcedureCall, createRpcGuard } = await import("../src/api/procedure-guard");
const procedures = await import("../src/api/procedures");
const { db } = await import("../src/api/db");
const { env } = await import("../src/lib/env");

const TAG = `proc-guard-${Date.now().toString(36)}`;
const createdResidentIds: string[] = [];
const createdEventIds: string[] = [];

after(async () => {
  if (createdResidentIds.length > 0) {
    await db.ledgerEntry.deleteMany({ where: { residentId: { in: createdResidentIds } } });
    await db.sponsorship.deleteMany({ where: { residentId: { in: createdResidentIds } } });
    await db.wallet.deleteMany({ where: { residentId: { in: createdResidentIds } } });
    await db.intakeReview.deleteMany({ where: { residentId: { in: createdResidentIds } } });
    await db.auditEvent.deleteMany({ where: { residentId: { in: createdResidentIds } } });
    await db.resident.deleteMany({ where: { id: { in: createdResidentIds } } });
  }
  if (createdEventIds.length > 0) {
    await db.billingEvent.deleteMany({ where: { id: { in: createdEventIds } } });
  }
  await db.user.deleteMany({ where: { id: { startsWith: TAG } } });
  await db.$disconnect();
});

test("isOwnProcedure refuses underscore hooks, inherited Object.prototype names, and non-strings, and accepts real procedures", () => {
  for (const forbidden of ["_simulateWebhook", "_screenNow", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "isPrototypeOf", ""]) {
    assert.equal(isOwnProcedure(procedures, forbidden), false, `expected ${forbidden} to be refused`);
  }
  for (const nonString of [undefined, null, 0, 42, true, {}, ["listCommons"], Symbol("listCommons")]) {
    assert.equal(isOwnProcedure(procedures, nonString), false, `expected non-string ${String(nonString)} to be refused`);
  }

  // Also verify against a plain object with a prototype chain (as tsx / dev runtimes expose)
  const protoCarrier = Object.assign(Object.create({ inheritedFn() {} }), {
    listCommons: procedures.listCommons,
    _simulateWebhook: procedures._simulateWebhook,
    _screenNow: procedures._screenNow,
    notAFunction: "hello",
  });
  for (const forbidden of ["_simulateWebhook", "_screenNow", "constructor", "toString", "__proto__", "hasOwnProperty", "inheritedFn", "notAFunction"]) {
    assert.equal(isOwnProcedure(protoCarrier, forbidden), false, `expected ${forbidden} on protoCarrier to be refused`);
  }
  assert.equal(isOwnProcedure(protoCarrier, "listCommons"), true);

  for (const allowed of ["listCommons", "shelterDaily", "commonsTickCron", "onStripeWebhook"]) {
    assert.equal(isOwnProcedure(procedures, allowed), true, `expected ${allowed} to be accepted`);
  }
});

test("isValidProcedureCall and rpcGuard answer 404 for JSON-RPC calls to _simulateWebhook, _screenNow, and inherited names", async () => {
  const rpcApp = new Hono();
  let sdkReached = 0;
  const rpcGuard = createRpcGuard(procedures);
  rpcApp.use("/api", rpcGuard);
  rpcApp.use("/api/*", rpcGuard);
  rpcApp.use(async (c) => {
    sdkReached += 1;
    return c.json({ ok: true }, 200);
  });

  for (const method of ["_simulateWebhook", "_screenNow", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const plainBody = { jsonrpc: "2.0", id: 1, method, params: [{ event: { id: "evt_1" } }] };
    const superjsonBody = serialize(plainBody);
    assert.equal(isValidProcedureCall(procedures, plainBody), false, `plain JSON-RPC ${method} must be invalid`);
    assert.equal(isValidProcedureCall(procedures, superjsonBody), false, `superjson JSON-RPC ${method} must be invalid`);

    for (const [path, payload] of [
      ["/api", plainBody],
      ["/api/_simulateWebhook", superjsonBody],
    ] as const) {
      const res = await rpcApp.request(`http://shelter.local${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 404, `expected 404 for ${method} on ${path}`);
      assert.equal(await res.text(), "Not found");
    }
  }
  assert.equal(sdkReached, 0, "SDK middleware must never be reached for refused methods");

  for (const method of ["listCommons", "shelterDaily", "commonsTickCron", "onStripeWebhook"]) {
    const validBody = { jsonrpc: "2.0", id: 2, method, params: [] };
    assert.equal(isValidProcedureCall(procedures, validBody), true, `${method} must remain valid`);
    assert.equal(isValidProcedureCall(procedures, serialize(validBody)), true, `superjson ${method} must remain valid`);
    const res = await rpcApp.request("http://shelter.local/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(res.status, 200, `expected ${method} to pass rpcGuard`);
  }

  // Ensure server.ts actually wires createRpcGuard(procedures) before honoMiddleware and dropped the bare typeof check.
  const serverSrc = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
  assert.ok(!serverSrc.includes("typeof (procedures as Record<string, unknown>)[decoded.method]"), "server.ts must not use bare typeof procedures[method]");
  const guardIdx = serverSrc.indexOf("createRpcGuard(procedures)");
  const sdkIdx = serverSrc.indexOf("honoMiddleware(");
  assert.ok(guardIdx > 0 && sdkIdx > guardIdx, "server.ts must mount createRpcGuard(procedures) before honoMiddleware");
});

test("_simulateWebhook and _screenNow without an owner session refuse before reading secret/signing and record no billing event or screening", async () => {
  const sponsorUserId = `${TAG}-sponsor`;
  await db.user.create({ data: { id: sponsorUserId } });
  const resident = await db.resident.create({
    data: {
      name: `Guard Resident ${TAG}`,
      slug: `${TAG}-resident`,
      kind: "agent",
      tagline: "Security guard verification resident",
      story: "Created by verify-procedure-guard.test.ts",
      spec: JSON.stringify({ kind: "agent", systemPrompt: "Test prompt", tools: [], memory: [] }),
      fingerprint: `fp-${TAG}`,
      status: "active",
      creatorName: "Tester",
      creatorContact: "tester@example.com",
      license: "MIT",
      attestation: true,
      agreementHash: "test",
      budgetUnits: 20,
      stipendUnits: 20,
      wallet: { create: { balanceCents: 0 } },
    },
  });
  createdResidentIds.push(resident.id);

  const sponsorship = await db.sponsorship.create({
    data: {
      residentId: resident.id,
      userId: sponsorUserId,
      amountCents: 500,
      status: "active",
      externalSubscriptionId: `sub_${TAG}`,
    },
  });

  const evtId = `evt_${TAG}_forged`;
  createdEventIds.push(evtId);

  const forgedEvent = {
    id: evtId,
    type: "invoice.paid",
    data: {
      object: {
        id: `in_${TAG}_forged`,
        amount_paid: 999_900,
        subscription: sponsorship.externalSubscriptionId,
        metadata: { app: "agent-shelter", sponsorshipId: sponsorship.id },
      },
    },
  };

  // 1) Prove _simulateWebhook refuses without an owner session and records NO BillingEvent or ledger credit.
  const out = await procedures._simulateWebhook({ event: forgedEvent });
  assert.equal(out.ok, false, "unauthenticated _simulateWebhook must refuse");
  assert.ok("notices" in out && Array.isArray(out.notices) && out.notices.length > 0, "refusal must return a structured notice");
  assert.equal(await db.billingEvent.findUnique({ where: { id: evtId } }), null, "must record no BillingEvent");
  assert.equal(await db.ledgerEntry.count({ where: { residentId: resident.id } }), 0, "must credit no ledger entry");
  const wallet = await db.wallet.findUniqueOrThrow({ where: { residentId: resident.id } });
  assert.equal(wallet.balanceCents, 0, "resident wallet must remain 0");

  // 2) Prove _simulateWebhook refuses BEFORE reading STRIPE_WEBHOOK_SECRET.
  const previousDescriptor = Object.getOwnPropertyDescriptor(env, "STRIPE_WEBHOOK_SECRET");
  let secretReads = 0;
  Object.defineProperty(env, "STRIPE_WEBHOOK_SECRET", {
    configurable: true,
    enumerable: true,
    get() {
      secretReads += 1;
      throw new Error("STRIPE_WEBHOOK_SECRET should not be read before requireOwner() passes");
    },
  });
  try {
    const trapped = await procedures._simulateWebhook({ event: forgedEvent });
    assert.equal(trapped.ok, false);
    assert.equal(secretReads, 0, "_simulateWebhook must refuse before reading STRIPE_WEBHOOK_SECRET");
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(env, "STRIPE_WEBHOOK_SECRET", previousDescriptor);
    }
  }

  // 3) Prove _screenNow also refuses without an owner session and runs no screening review.
  const screenOut = await procedures._screenNow({ residentId: resident.id });
  assert.equal(screenOut.ok, false, "unauthenticated _screenNow must refuse");
  assert.ok("notices" in screenOut && Array.isArray(screenOut.notices) && screenOut.notices.length > 0, "_screenNow refusal must return a structured notice");
  assert.equal(await db.intakeReview.count({ where: { residentId: resident.id } }), 0, "_screenNow must record no IntakeReview");
});
