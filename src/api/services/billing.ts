import { createHmac, timingSafeEqual } from "node:crypto";
import { executeComposioTool } from "@adaptive-ai/sdk/server";
import { db } from "@/api/db";
import { settle } from "@/api/services/ledger";
import { env } from "@/lib/env";

/**
 * Sponsorships = Stripe subscriptions through the computer's Composio
 * connection (typed contracts, schemas checked 2026-09-16/17 in the sibling
 * apps). Same three rules as AiBeing billing:
 *  1. the LOCAL Sponsorship row decides state;
 *  2. webhook + confirm-on-return both refresh it (no single path load-bearing);
 *  3. fail closed on billing (unsigned webhook = rejected), fail open on
 *     service (Stripe unreachable when someone views a page = cached row).
 * This app never holds a Stripe secret key for this path.
 */

const TOOL_VERSION = "20260915_00" as const;

export const SPONSOR_TIERS_CENTS = [300, 900, 2500] as const;
export type SponsorTierCents = (typeof SPONSOR_TIERS_CENTS)[number];
export function isSponsorTier(v: number): v is SponsorTierCents {
  return (SPONSOR_TIERS_CENTS as readonly number[]).includes(v);
}
export function sponsorLookupKey(cents: number) {
  return `shelter_sponsor_${cents}_monthly`;
}

type StripeTool<Slug extends string, Args extends object> = { toolSlug: Slug; version: typeof TOOL_VERSION; connectedAccountId: string; arguments: Args };
type ListPricesArgs = StripeTool<"STRIPE_LIST_PRICES", { lookup_keys?: string[]; active?: boolean; limit?: number }>;
type CreatePriceArgs = StripeTool<
  "STRIPE_CREATE_PRICE",
  {
    currency: string;
    unit_amount: number;
    lookup_key?: string;
    transfer_lookup_key?: boolean;
    nickname?: string;
    recurring?: { interval: "month" | "year"; interval_count?: number };
    metadata?: Record<string, string>;
    product?: string;
    product_data?: { name: string; metadata?: Record<string, string> };
  }
>;
type CreateCheckoutSessionArgs = StripeTool<
  "STRIPE_CREATE_CHECKOUT_SESSION",
  {
    mode: "subscription";
    line_items: { price: string; quantity: number }[];
    success_url: string;
    cancel_url?: string;
    client_reference_id?: string;
    metadata?: Record<string, string>;
    subscription_data?: { metadata?: Record<string, string> };
  }
>;
type RetrieveCheckoutSessionArgs = StripeTool<"STRIPE_RETRIEVE_CHECKOUT_SESSION", { session: string; expand?: string[] }>;
type GetSubscriptionArgs = StripeTool<"STRIPE_GET_SUBSCRIPTION", { subscription_id: string }>;

type StripePrice = { id: string; lookup_key?: string | null; unit_amount?: number | null; active?: boolean; recurring?: { interval?: string } | null };
export type StripeCheckoutSession = { id: string; status?: string; mode?: string; payment_status?: string; url?: string | null; customer?: string | { id: string } | null; subscription?: string | { id: string } | null; metadata?: Record<string, string> };
export type StripeSubscription = { id: string; status?: string; customer?: string | { id: string }; current_period_end?: number; items?: { data?: { price?: { unit_amount?: number | null } }[] }; metadata?: Record<string, string> };

export class BillingUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingUnavailable";
  }
}
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const idOf = (ref: string | { id: string } | null | undefined) => (!ref ? null : typeof ref === "string" ? ref : ref.id);

export function billingConfigured(): boolean {
  return Boolean(env.STRIPE_CONNECTED_ACCOUNT_ID);
}
function accountId(): string {
  const id = env.STRIPE_CONNECTED_ACCOUNT_ID;
  if (!id) throw new BillingUnavailable("Sponsorships are not configured for this app yet.");
  return id;
}

// ─── Test seam: everything Stripe-side goes through here ─────────────────────

export type StripeGateway = {
  listPrices(lookupKey: string): Promise<StripePrice[]>;
  createPrice(args: CreatePriceArgs["arguments"]): Promise<StripePrice>;
  createCheckout(args: CreateCheckoutSessionArgs["arguments"]): Promise<StripeCheckoutSession>;
  retrieveCheckout(sessionId: string): Promise<StripeCheckoutSession>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
};

const realGateway: StripeGateway = {
  async listPrices(lookupKey) {
    const r = await executeComposioTool<ListPricesArgs>({ toolSlug: "STRIPE_LIST_PRICES", version: TOOL_VERSION, connectedAccountId: accountId(), arguments: { lookup_keys: [lookupKey], active: true, limit: 2 } });
    return ((r as { data?: StripePrice[] }).data ?? []) as StripePrice[];
  },
  async createPrice(args) {
    return (await executeComposioTool<CreatePriceArgs>({ toolSlug: "STRIPE_CREATE_PRICE", version: TOOL_VERSION, connectedAccountId: accountId(), arguments: args })) as StripePrice;
  },
  async createCheckout(args) {
    return (await executeComposioTool<CreateCheckoutSessionArgs>({ toolSlug: "STRIPE_CREATE_CHECKOUT_SESSION", version: TOOL_VERSION, connectedAccountId: accountId(), arguments: args })) as StripeCheckoutSession;
  },
  async retrieveCheckout(sessionId) {
    return (await executeComposioTool<RetrieveCheckoutSessionArgs>({ toolSlug: "STRIPE_RETRIEVE_CHECKOUT_SESSION", version: TOOL_VERSION, connectedAccountId: accountId(), arguments: { session: sessionId, expand: ["subscription"] } })) as StripeCheckoutSession;
  },
  async retrieveSubscription(id) {
    return (await executeComposioTool<GetSubscriptionArgs>({ toolSlug: "STRIPE_GET_SUBSCRIPTION", version: TOOL_VERSION, connectedAccountId: accountId(), arguments: { subscription_id: id } })) as StripeSubscription;
  },
};
let gateway: StripeGateway = realGateway;
export function useStripeGateway(g: StripeGateway | null) {
  gateway = g ?? realGateway;
}

// ─── Prices (resolved by lookup_key; created once if missing) ────────────────

const priceCache = new Map<string, { id: string; at: number }>();
export async function ensureSponsorPrice(cents: SponsorTierCents): Promise<string> {
  const key = sponsorLookupKey(cents);
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.id;
  let prices: StripePrice[];
  try {
    prices = await gateway.listPrices(key);
  } catch (error) {
    throw new BillingUnavailable(`Could not reach the billing provider: ${describe(error)}`);
  }
  let price = prices.find((p) => p.lookup_key === key && p.active !== false);
  if (!price) {
    try {
      price = await gateway.createPrice({
        currency: "eur",
        unit_amount: cents,
        lookup_key: key,
        transfer_lookup_key: true,
        nickname: `Agent Shelter sponsorship €${(cents / 100).toFixed(0)}/mo`,
        recurring: { interval: "month" },
        metadata: { app: "agent-shelter", kind: "sponsorship", cents: String(cents) },
        product_data: { name: `Agent Shelter Sponsorship €${(cents / 100).toFixed(0)}/mo`, metadata: { app: "agent-shelter", kind: "sponsorship" } },
      });
    } catch (error) {
      throw new BillingUnavailable(`Could not register the sponsorship price: ${describe(error)}`);
    }
  }
  if (!price?.id) throw new BillingUnavailable("The billing provider returned a price without an id.");
  priceCache.set(key, { id: price.id, at: Date.now() });
  return price.id;
}

export async function createSponsorCheckout(input: { sponsorshipId: string; residentId: string; residentName: string; userId: string; cents: SponsorTierCents; successUrl: string; cancelUrl: string }) {
  const price = await ensureSponsorPrice(input.cents);
  let session: StripeCheckoutSession;
  try {
    session = await gateway.createCheckout({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.sponsorshipId,
      metadata: { app: "agent-shelter", sponsorshipId: input.sponsorshipId, residentId: input.residentId, userId: input.userId },
      subscription_data: { metadata: { app: "agent-shelter", sponsorshipId: input.sponsorshipId, residentId: input.residentId, resident: input.residentName.slice(0, 80) } },
    });
  } catch (error) {
    throw new BillingUnavailable(`Could not open a checkout: ${describe(error)}`);
  }
  if (!session?.id || !session.url) throw new BillingUnavailable("The billing provider returned a checkout without a URL.");
  return { id: session.id, url: session.url };
}

// ─── Applying state ──────────────────────────────────────────────────────────

function mapStatus(s: string | undefined): "active" | "past_due" | "canceled" | "pending" {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid" || s === "incomplete") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "pending";
}

/** Applies a subscription snapshot to the local row and settles the FIRST month once. */
export async function applySubscription(input: { sponsorshipId: string; sub: StripeSubscription; customerId?: string | null }) {
  const row = await db.sponsorship.findUnique({ where: { id: input.sponsorshipId }, include: { resident: true } });
  if (!row) return { applied: false as const, detail: "no such sponsorship" };
  const status = mapStatus(input.sub.status);
  const periodEnd = input.sub.current_period_end ? new Date(input.sub.current_period_end * 1000) : row.currentPeriodEnd;
  await db.sponsorship.update({
    where: { id: row.id },
    data: {
      status,
      externalSubscriptionId: input.sub.id,
      externalCustomerId: idOf(input.sub.customer) ?? input.customerId ?? row.externalCustomerId,
      currentPeriodEnd: periodEnd,
    },
  });
  let settled = false;
  if (status === "active") {
    const out = await settle({ residentId: row.residentId, reference: `${input.sub.id}:first`, kind: "sponsorship", amountCents: row.amountCents, creatorSharePct: row.resident.creatorSharePct, note: `Sponsorship ${row.id} — first month` });
    settled = out.outcome === "settled";
    if (row.resident.status === "hibernated") {
      await db.resident.update({ where: { id: row.residentId }, data: { status: "active", hibernatedAt: null, statusNote: "Woken by a sponsor" } });
      await db.auditEvent.create({ data: { residentId: row.residentId, actor: "sponsor", action: "woken", detail: `Sponsorship ${row.id}` } });
    }
  }
  return { applied: true as const, status, settled };
}

/** Confirm-on-return: the success URL carries the session id; re-read it server-side. */
export async function confirmSponsorCheckout(input: { sessionId: string; userId: string }) {
  const row = await db.sponsorship.findFirst({ where: { checkoutSessionId: input.sessionId, userId: input.userId } });
  if (!row) return { ok: false as const, detail: "That checkout does not belong to you." };
  if (row.status === "active") return { ok: true as const, status: "active" as const, already: true };
  let session: StripeCheckoutSession;
  try {
    session = await gateway.retrieveCheckout(input.sessionId);
  } catch (error) {
    throw new BillingUnavailable(`Could not confirm the checkout yet: ${describe(error)}`);
  }
  if (session.status !== "complete") return { ok: true as const, status: "pending" as const, already: false };
  const subId = idOf(session.subscription as string | { id: string } | null | undefined);
  if (!subId) return { ok: true as const, status: "pending" as const, already: false };
  const sub = typeof session.subscription === "object" && session.subscription && "status" in session.subscription ? (session.subscription as StripeSubscription) : await gateway.retrieveSubscription(subId);
  const applied = await applySubscription({ sponsorshipId: row.id, sub, customerId: idOf(session.customer as string | { id: string } | null | undefined) });
  return { ok: true as const, status: applied.applied ? applied.status : ("pending" as const), already: false };
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

const SIGNATURE_TOLERANCE_SEC = 300;

export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing Stripe-Signature header" };
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || sigs.length === 0) return { ok: false, reason: "malformed Stripe-Signature header" };
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: "non-numeric timestamp" };
  if (Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) return { ok: false, reason: "timestamp outside tolerance (replay?)" };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "hex");
  const match = sigs.some((s) => {
    const buf = Buffer.from(s, "hex");
    return buf.length === expected.length && timingSafeEqual(buf, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export function signForTest(rawBody: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${createHmac("sha256", secret).update(`${nowSec}.${rawBody}`, "utf8").digest("hex")}`;
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };
export type WebhookOutcome = { ok: boolean; eventId: string | null; outcome: "applied" | "ignored" | "rejected" | "duplicate"; detail: string };

async function record(event: StripeEvent, outcome: WebhookOutcome["outcome"], detail: string): Promise<WebhookOutcome> {
  await db.billingEvent.upsert({ where: { id: event.id }, create: { id: event.id, type: event.type, outcome, detail }, update: {} });
  return { ok: outcome !== "rejected", eventId: event.id, outcome, detail };
}

export async function handleStripeEvent(event: StripeEvent): Promise<WebhookOutcome> {
  const seen = await db.billingEvent.findUnique({ where: { id: event.id } });
  if (seen) return { ok: true, eventId: event.id, outcome: "duplicate", detail: `already ${seen.outcome}` };
  const obj = event.data.object;
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const subMeta = ((obj.subscription_details as { metadata?: Record<string, string> } | undefined)?.metadata ?? {}) as Record<string, string>;
  const isOurs = meta.app === "agent-shelter" || subMeta.app === "agent-shelter";

  if (event.type === "checkout.session.completed") {
    if (!isOurs) return record(event, "ignored", "not an Agent Shelter checkout");
    const sponsorshipId = meta.sponsorshipId ?? (obj.client_reference_id as string | undefined);
    const subId = idOf(obj.subscription as string | { id: string } | null | undefined);
    if (!sponsorshipId || !subId) return record(event, "ignored", "checkout without sponsorship/subscription");
    const sub = await gateway.retrieveSubscription(subId);
    const applied = await applySubscription({ sponsorshipId, sub, customerId: idOf(obj.customer as string | { id: string } | null | undefined) });
    return record(event, applied.applied ? "applied" : "ignored", applied.applied ? `sponsorship ${sponsorshipId} → ${applied.status}` : applied.detail);
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    if (!isOurs) return record(event, "ignored", "not an Agent Shelter subscription");
    const sponsorshipId = meta.sponsorshipId;
    if (!sponsorshipId) return record(event, "ignored", "subscription without sponsorshipId");
    const applied = await applySubscription({ sponsorshipId, sub: obj as unknown as StripeSubscription });
    return record(event, applied.applied ? "applied" : "ignored", applied.applied ? `sponsorship ${sponsorshipId} → ${applied.status}` : applied.detail);
  }
  if (event.type === "invoice.paid") {
    if (!isOurs) return record(event, "ignored", "not an Agent Shelter invoice");
    const reason = obj.billing_reason as string | undefined;
    const subId = idOf(obj.subscription as string | { id: string } | null | undefined) ?? (obj.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription ?? null;
    const sponsorshipId = subMeta.sponsorshipId ?? meta.sponsorshipId;
    const row = sponsorshipId ? await db.sponsorship.findUnique({ where: { id: sponsorshipId }, include: { resident: true } }) : subId ? await db.sponsorship.findFirst({ where: { externalSubscriptionId: subId }, include: { resident: true } }) : null;
    if (!row) return record(event, "ignored", "invoice for an unknown sponsorship");
    const amount = Number(obj.amount_paid ?? row.amountCents);
    // The first invoice shares its reference with the confirm-on-return path, so it is never counted twice.
    const reference = reason === "subscription_create" && subId ? `${subId}:first` : `inv:${obj.id as string}`;
    const out = await settle({ residentId: row.residentId, reference, kind: "sponsorship", amountCents: amount, creatorSharePct: row.resident.creatorSharePct, note: `Sponsorship ${row.id} — invoice ${obj.id as string}` });
    await db.sponsorship.update({ where: { id: row.id }, data: { status: "active" } });
    return record(event, "applied", `invoice ${obj.id as string} → ${out.outcome}`);
  }
  if (event.type === "invoice.payment_failed") {
    if (!isOurs) return record(event, "ignored", "not an Agent Shelter invoice");
    const sponsorshipId = subMeta.sponsorshipId ?? meta.sponsorshipId;
    if (sponsorshipId) await db.sponsorship.updateMany({ where: { id: sponsorshipId }, data: { status: "past_due" } });
    return record(event, "applied", `sponsorship ${sponsorshipId ?? "?"} → past_due`);
  }
  return record(event, "ignored", `unhandled type ${event.type}`);
}

export async function processWebhook(input: { body: string; headers: Record<string, string | string[]> }): Promise<WebhookOutcome> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, eventId: null, outcome: "rejected", detail: "webhook secret not configured" };
  const raw = input.headers["stripe-signature"] ?? input.headers["Stripe-Signature"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const verified = verifyStripeSignature(input.body, header, secret);
  if (!verified.ok) return { ok: false, eventId: null, outcome: "rejected", detail: verified.reason };
  let event: StripeEvent;
  try {
    event = JSON.parse(input.body) as StripeEvent;
    if (!event?.id || !event.type || !event.data?.object) throw new Error("not a Stripe event");
  } catch (error) {
    return { ok: false, eventId: null, outcome: "rejected", detail: `unparseable body: ${describe(error)}` };
  }
  try {
    return await handleStripeEvent(event);
  } catch (error) {
    return { ok: false, eventId: event.id, outcome: "rejected", detail: describe(error) };
  }
}
