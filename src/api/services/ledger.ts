import { db } from "@/api/db";

/**
 * The economy, in integer cents. Append-only ledger; three rows per euro that
 * moves (resident / shelter / creator) sharing one `reference`. The unique
 * index on (reference, party) is the idempotency lock: a replayed webhook or
 * receipt inserts nothing and reports `duplicate`.
 */

export const SHELTER_SHARE_PCT = 20;
export const DEFAULT_CREATOR_SHARE_PCT = 10;
/** A resident buys its own compute with its wallet: 1 model unit = 5 cents. */
export const UNIT_PRICE_CENTS = 5;

export type Split = { resident: number; shelter: number; creator: number };

/**
 * 70/20/10 by default. The creator's share is configurable 0–10 %; whatever
 * the creator waives goes to the RESIDENT (not the shelter) — the agreement
 * promises the shelter never takes more than 20 %. Rounding remainders go to
 * the resident so the three parts always sum to the total.
 */
export function splitCents(total: number, creatorSharePct: number = DEFAULT_CREATOR_SHARE_PCT): Split {
  if (!Number.isInteger(total) || total < 0) throw new Error("splitCents needs a non-negative integer");
  const creatorPct = Math.min(DEFAULT_CREATOR_SHARE_PCT, Math.max(0, Math.round(creatorSharePct)));
  const shelter = Math.floor((total * SHELTER_SHARE_PCT) / 100);
  const creator = Math.floor((total * creatorPct) / 100);
  const resident = total - shelter - creator;
  return { resident, shelter, creator };
}

export type SettleInput = {
  residentId: string;
  reference: string;
  kind: "hire" | "sponsorship" | "adoption";
  amountCents: number;
  creatorSharePct: number;
  note?: string;
};

export type SettleOutcome = { outcome: "settled"; split: Split } | { outcome: "duplicate" } | { outcome: "invalid"; detail: string };

/** Records one paid event and credits the resident's wallet. Idempotent by reference. */
export async function settle(input: SettleInput): Promise<SettleOutcome> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { outcome: "invalid", detail: "amount must be a positive integer of cents" };
  }
  const existing = await db.ledgerEntry.findUnique({ where: { reference_party: { reference: input.reference, party: "resident" } } });
  if (existing) return { outcome: "duplicate" };
  const split = splitCents(input.amountCents, input.creatorSharePct);
  try {
    await db.$transaction([
      db.ledgerEntry.create({ data: { residentId: input.residentId, reference: input.reference, party: "resident", kind: input.kind, amountCents: split.resident, note: input.note } }),
      db.ledgerEntry.create({ data: { residentId: input.residentId, reference: input.reference, party: "shelter", kind: input.kind, amountCents: split.shelter, note: input.note } }),
      db.ledgerEntry.create({ data: { residentId: input.residentId, reference: input.reference, party: "creator", kind: input.kind, amountCents: split.creator, note: input.note } }),
      db.wallet.upsert({
        where: { residentId: input.residentId },
        create: { residentId: input.residentId, balanceCents: split.resident },
        update: { balanceCents: { increment: split.resident } },
      }),
      db.resident.update({ where: { id: input.residentId }, data: { earnedCents: { increment: input.amountCents } } }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { outcome: "duplicate" };
    throw error;
  }
  return { outcome: "settled", split };
}

/** Owner marks money as paid out (creator share) or spent (resident share on external costs). */
export async function recordPayout(input: { residentId: string | null; party: "creator" | "resident"; amountCents: number; note: string; reference: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { outcome: "invalid" as const };
  try {
    await db.$transaction([
      db.ledgerEntry.create({ data: { residentId: input.residentId, reference: input.reference, party: input.party, kind: "payout", amountCents: -input.amountCents, note: input.note } }),
      ...(input.party === "resident" && input.residentId
        ? [db.wallet.update({ where: { residentId: input.residentId }, data: { balanceCents: { decrement: input.amountCents }, paidOutCents: { increment: input.amountCents } } })]
        : []),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { outcome: "duplicate" as const };
    throw error;
  }
  return { outcome: "recorded" as const };
}

/** Balances per party: sum of ledger rows. Creator balances are grouped per resident. */
export async function balances() {
  const rows = await db.ledgerEntry.groupBy({ by: ["party", "residentId"], _sum: { amountCents: true } });
  const perResident = new Map<string, { resident: number; creator: number }>();
  let shelter = 0;
  for (const r of rows) {
    const sum = r._sum.amountCents ?? 0;
    if (r.party === "shelter") shelter += sum;
    else if (r.residentId) {
      const cur = perResident.get(r.residentId) ?? { resident: 0, creator: 0 };
      if (r.party === "resident") cur.resident += sum;
      if (r.party === "creator") cur.creator += sum;
      perResident.set(r.residentId, cur);
    }
  }
  return { shelterCents: shelter, perResident };
}

/**
 * A resident with no budget left buys units from its own wallet. Returns the
 * units bought (0 when broke). Runs inside the caller's request path — a single
 * small update.
 */
export async function buyUnitsFromWallet(residentId: string, units: number): Promise<number> {
  const wallet = await db.wallet.findUnique({ where: { residentId } });
  if (!wallet) return 0;
  const affordable = Math.min(units, Math.floor(wallet.balanceCents / UNIT_PRICE_CENTS));
  if (affordable <= 0) return 0;
  const cost = affordable * UNIT_PRICE_CENTS;
  const reference = `self-fund:${residentId}:${Date.now()}`;
  await db.$transaction([
    db.wallet.update({ where: { residentId }, data: { balanceCents: { decrement: cost } } }),
    db.ledgerEntry.create({ data: { residentId, reference, party: "resident", kind: "adjustment", amountCents: -cost, note: `Bought ${affordable} compute unit(s) from own wallet` } }),
    db.resident.update({ where: { id: residentId }, data: { budgetUnits: { increment: affordable } } }),
  ]);
  return affordable;
}
