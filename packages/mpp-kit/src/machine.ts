import crypto from "node:crypto";
import { Receipt } from "mppx";
import { Mppx, stripe } from "mppx/server";
import Stripe from "stripe";
import { maskKey, type MppConfig } from "./config.ts";
import { centsToAmount, CURRENCY, type MachineProduct } from "./prices.ts";
import { problems } from "./problem.ts";

/**
 * The one Stripe surface refunds need. Duck-typed (like `StripeLikeClient`) so
 * the kit never leaks the `stripe` package's types into consuming apps — each
 * app has its own copy of the SDK and TypeScript treats the two as unrelated.
 */
export type RefundClient = {
  refunds: {
    create: (
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{ id: string }>;
  };
};

/**
 * The one Stripe surface mppx needs: create a PaymentIntent with a shared
 * payment token. Duck-typed so tests can inject a fake and the apps can share a
 * single real client. Matches mppx's own `StripeClient` shape.
 */
export type StripeLikeClient = {
  paymentIntents: {
    create: (
      params: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{
      id: string;
      status: string;
      lastResponse?: { headers?: Record<string, string> } | undefined;
    }>;
  };
};

/**
 * What the app persists per successful payment. Keyed by the PaymentIntent id
 * (`receipt.reference`), so a replayed credential — which Stripe already
 * refuses through its idempotency key, and mppx surfaces as a 402 — can also
 * never be redeemed twice on our side even if both of those failed.
 */
export type PaymentRecord = {
  /** PaymentIntent id, e.g. `pi_…` */
  reference: string;
  product: string;
  amountCents: number;
  currency: string;
  /** Route scope the challenge was bound to, e.g. `/api/mpp/generate`. */
  scope: string;
  livemode: boolean;
  /** Challenge meta echoed back by mppx. */
  meta: Record<string, string>;
};

export type PaymentStore = {
  /** Insert-if-absent. Return `duplicate` when the reference already exists. */
  record(payment: PaymentRecord): Promise<"created" | "duplicate">;
};

export type MachinePaymentsHealth = {
  state: "ready" | "unconfigured";
  mode: "live" | "sandbox" | null;
  livemode: boolean;
  currency: string;
  /** Masked — safe to render to the owner. */
  key: string | null;
  profileId: string | null;
  realm: string;
  detail: string;
};

export type PaidOutcome =
  | { kind: "unconfigured"; response: Response }
  | { kind: "challenge"; response: Response }
  | { kind: "duplicate"; response: Response; reference: string }
  | {
      kind: "paid";
      receipt: Receipt.Receipt;
      reference: string;
      /**
       * Build the final response. Adds the `Payment-Receipt` header so the
       * agent can prove it paid. Call exactly once.
       */
      respond: (response: Response) => Response;
    };

export type ChargeOptions = {
  product: MachineProduct;
  /** Route path; credentials are bound to it and refused elsewhere. */
  scope: string;
  /** Flat string map carried in the challenge; echoed on success. */
  meta?: Record<string, string>;
};

export type MachinePayments = {
  configured: boolean;
  config: MppConfig;
  realm: string;
  health(): MachinePaymentsHealth;
  /**
   * Run the 402 lifecycle for one request. On `paid`, the payment has been
   * recorded in the store and is ready to be delivered against.
   */
  charge(options: ChargeOptions, request: Request): Promise<PaidOutcome>;
  /** The underlying Stripe client, for refunds. `null` when unconfigured. */
  stripe: RefundClient | null;
};

/**
 * Same derivation Stripe's own sample uses: the challenge-signing secret is an
 * HMAC of the API key, so it rotates with the key and never needs storing.
 * https://mpp.dev/protocol/challenges#challenge-binding
 */
export function challengeSecretFrom(apiKey: string): string {
  return crypto
    .createHmac("sha256", apiKey)
    .update("mpp-challenge-signing")
    .digest("base64");
}

export function createMachinePayments(input: {
  config: MppConfig;
  /** Hostname agents will see, e.g. `sketchmonkey-neuraldeepnet.on.adaptive.ai`. */
  realm: string;
  store: PaymentStore;
  /** Test seam. Defaults to a real Stripe SDK client built from the key. */
  stripeClient?: StripeLikeClient;
  /** Observability hook. Never throws into the request path. */
  onEvent?: (event: MachineEvent) => void;
}): MachinePayments {
  const { config, realm, store } = input;
  const emit = (event: MachineEvent) => {
    try {
      input.onEvent?.(event);
    } catch {
      /* observers must not affect payment control flow */
    }
  };

  if (!config.configured) {
    return {
      configured: false,
      config,
      realm,
      stripe: null,
      health: () => ({
        state: "unconfigured",
        mode: null,
        livemode: false,
        currency: CURRENCY,
        key: null,
        profileId: null,
        realm,
        detail: config.reason,
      }),
      charge: async () => ({
        kind: "unconfigured",
        response: problems.unconfigured(config.reason),
      }),
    };
  }

  const realStripe = input.stripeClient
    ? null
    : new Stripe(config.key, {
        // mppx passes its own preview `apiVersion` per request; this is the
        // baseline for anything else we do with the client (refunds).
        maxNetworkRetries: 2,
        timeout: 20_000,
      });
  const client: StripeLikeClient =
    input.stripeClient ?? (realStripe as unknown as StripeLikeClient);

  const method = stripe.charge({
    client,
    networkId: config.profileId,
    currency: CURRENCY,
    decimals: 2,
    paymentMethodTypes: ["card"],
    metadata: { realm },
  });

  const mppx = Mppx.create({
    methods: [method],
    secretKey: challengeSecretFrom(config.key),
    realm,
  });

  // Narrowed once: `config` cannot change after construction.
  const livemode = config.livemode;

  // mppx clones the Request before dispatch, so a WeakMap keyed on the caller's
  // Request would never match. Read the receipt back off a probe response
  // instead — `withReceipt` is pure, so calling it twice is safe.
  async function charge(
    options: ChargeOptions,
    request: Request,
  ): Promise<PaidOutcome> {
    const handler = mppx.charge({
      amount: centsToAmount(options.product.amountCents),
      description: options.product.description,
      scope: options.scope,
      meta: { product: options.product.id, ...(options.meta ?? {}) },
    });

    const result = await handler(request);

    if (result.status === 402) {
      emit({
        kind: "challenge",
        scope: options.scope,
        product: options.product.id,
        amountCents: options.product.amountCents,
        // A 402 is also what a FAILED payment looks like — the body says which.
        status: result.challenge.status,
      });
      return { kind: "challenge", response: result.challenge };
    }

    const receipt = Receipt.fromResponse(
      result.withReceipt(new Response(null, { status: 204 })),
    );
    const record: PaymentRecord = {
      reference: receipt.reference,
      product: options.product.id,
      amountCents: options.product.amountCents,
      currency: CURRENCY,
      scope: options.scope,
      livemode,
      meta: options.meta ?? {},
    };

    const stored = await store.record(record);
    if (stored === "duplicate") {
      emit({ kind: "duplicate", reference: receipt.reference, scope: options.scope });
      return {
        kind: "duplicate",
        reference: receipt.reference,
        response: problems.duplicate(receipt.reference),
      };
    }

    emit({
      kind: "paid",
      reference: receipt.reference,
      scope: options.scope,
      product: options.product.id,
      amountCents: options.product.amountCents,
      livemode,
    });

    return {
      kind: "paid",
      receipt,
      reference: receipt.reference,
      respond: (response) => result.withReceipt(response),
    };
  }

  return {
    configured: true,
    config,
    realm,
    stripe: realStripe as unknown as RefundClient | null,
    health: () => ({
      state: "ready",
      mode: config.mode,
      livemode: config.livemode,
      currency: CURRENCY,
      key: maskKey(config.key),
      profileId: config.profileId,
      realm,
      detail: config.livemode
        ? "Accepting live card payments from agents (Stripe shared payment tokens)."
        : "Sandbox mode — test payments only, no real money moves.",
    }),
    charge,
  };
}

export type MachineEvent =
  | {
      kind: "challenge";
      scope: string;
      product: string;
      amountCents: number;
      status: number;
    }
  | {
      kind: "paid";
      reference: string;
      scope: string;
      product: string;
      amountCents: number;
      livemode: boolean;
    }
  | { kind: "duplicate"; reference: string; scope: string };

/**
 * Refund a redeemed payment when we could not deliver. Best-effort: the
 * restricted key needs `Refunds: write`; without it Stripe answers 403 and the
 * caller records `refund_pending` for the owner to settle by hand.
 */
export async function refundPayment(
  client: RefundClient | null,
  reference: string,
  reason: string,
): Promise<
  | { ok: true; refundId: string }
  | { ok: false; error: string; permission: boolean }
> {
  if (!client) return { ok: false, error: "No Stripe client configured.", permission: false };
  try {
    const refund = await client.refunds.create(
      { payment_intent: reference, metadata: { reason: reason.slice(0, 500) } },
      { idempotencyKey: `mpp_refund_${reference}` },
    );
    return { ok: true, refundId: refund.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permission =
      /permission|not allowed|restricted/i.test(message) ||
      (error as { statusCode?: number }).statusCode === 403;
    return { ok: false, error: message, permission };
  }
}
