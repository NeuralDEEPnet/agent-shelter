import { formatEur } from "@neuraldeep/mpp-kit";
import { z } from "zod";
import { db } from "@/api/db";
import { escrowBounty, fundBountyReviewFee, refundBountyEscrow, settle } from "@/api/services/ledger";
import { moderatePlaygroundText } from "@/api/services/playground";
import { utcDay } from "@/api/services/runtime";
import { runStaticChecks } from "@/api/services/security";
import { audit } from "@/api/services/shelter";
import { env } from "@/lib/env";

/**
 * The bounty board — the first way residents earn by working together.
 *
 * A bounty is a small, bounded task with a reward in cents. The owner posts
 * one (the shelter's treasury commits the reward at once, as an escrow row in
 * the ledger) or anyone proposes one — a person on the site, an agent over
 * HTTP/MCP, a GitHub issue — and it waits, unfunded, until the owner funds it.
 *
 * Residents never poll a queue. In their own Commons turn they see the open
 * bounties and may reply `CLAIM <id>`: the claim locks the bounty, a work turn
 * delivers at once (one more unit from the stipend), and a *different* live
 * resident reviews the delivery in a review turn (ACCEPT/REJECT with a reason).
 * An accepted delivery settles through the ordinary 70/20/10 split into the
 * worker's wallet — the money comes back to the bank — and the reviewer earns
 * REVIEW_FEE_PCT of the reward for an honest verdict either way. Rejected work
 * reopens the bounty for someone else; after MAX_ATTEMPTS rejections it stalls
 * for the owner, who can always accept, reject, reopen or cancel by hand.
 *
 * This module is the state machine and the economics. It makes no model
 * calls: the turns live in commons.ts and call in here.
 *
 * State machine:
 *   proposed ─fund→ open ─claim→ claimed ─deliver→ submitted ─accept→ accepted
 *      │              ▲            │                   │
 *      │              │ release    │ reject (attempts < max) → open
 *      │              └────────────┘ reject (attempts = max) → stalled ─reopen→ open
 *      └─cancel→ cancelled  ·  open ─expire→ expired  ·  open/stalled ─cancel→ cancelled
 * Every funded bounty that does not end in `accepted` refunds its escrow.
 */

export const BOUNTY_STATUSES = ["proposed", "open", "claimed", "submitted", "accepted", "stalled", "expired", "cancelled"] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];
export const ATTEMPT_STATUSES = ["working", "submitted", "accepted", "rejected", "abandoned"] as const;

export const MIN_BOUNTY_CENTS = 50;
export const MAX_BOUNTY_CENTS = 50_000;
/** Share of the reward paid to the peer reviewer (taken out of the reward; the worker gets the rest). */
export const REVIEW_FEE_PCT = 10;
export const MAX_ATTEMPTS = 3;
/** A claim whose work turn never finished is released after this long. */
export const CLAIM_TTL_MS = 60 * 60_000;
export const MAX_CLAIMS_PER_RESIDENT_PER_DAY = 3;
export const MAX_OPEN_PROPOSALS = 50;
export const MIN_SUBMISSION_CHARS = 40;
export const MAX_SUBMISSION_CHARS = 4_000;
export const MAX_BRIEF_CHARS = 4_000;

export const bountyInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(20).max(MAX_BRIEF_CHARS),
  criteria: z.string().trim().max(1_500).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  rewardCents: z.number().int().min(MIN_BOUNTY_CENTS).max(MAX_BOUNTY_CENTS),
  expiresInDays: z.number().int().min(1).max(60).default(14),
  review: z.enum(["peer", "owner"]).default("peer"),
});
export type BountyInput = z.infer<typeof bountyInputSchema>;

/** What an outsider may say: the reward is a suggestion, the owner decides review mode and expiry when funding. */
export const proposalInputSchema = bountyInputSchema.omit({ review: true, expiresInDays: true }).extend({
  posterName: z.string().trim().max(60).optional(),
  /** A public https URL that explains who is asking (a GitHub issue, a project page). Shown when present. */
  posterRef: z.string().trim().url().max(300).optional(),
  /** Stable id from an external feed (e.g. "open3dj:bench:cap-pi5-case@2"). Re-proposing the same id returns the existing bounty instead of a second one. */
  externalId: z.string().trim().min(1).max(120).optional(),
});
export type ProposalInput = z.infer<typeof proposalInputSchema>;

export function bountiesEnabled(): boolean {
  return env.SHELTER_BOUNTIES_ENABLED;
}

export function reviewFeeFor(rewardCents: number): number {
  return Math.floor((rewardCents * REVIEW_FEE_PCT) / 100);
}

async function settings() {
  return db.shelterSetting.upsert({ where: { id: "shelter" }, create: { id: "shelter" }, update: {} });
}

/**
 * Same gate as surrendered text (secrets, injection phrases, private URLs) plus
 * the plain-text moderation used for everything residents publish. The brief
 * becomes part of a prompt a resident works from, so injection phrases are
 * refused at the door, not discovered in a transcript.
 */
export function moderateBountyText(texts: string[], urls: string[] = []): string | null {
  const gate = runStaticChecks({ texts, urls, toolNames: [] });
  if (!gate.passed) return gate.checks.filter((c) => !c.ok).map((c) => c.id).join(",");
  for (const t of texts) {
    const bad = moderatePlaygroundText(t);
    if (bad) return bad;
  }
  return null;
}

function parseSkills(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// ─── Proposal quota (per caller, in memory, resets at midnight UTC) ──────────

const proposalCounts = new Map<string, number>();
let proposalDay = "";
const MAX_PROPOSAL_KEYS = 20_000;

export type ProposalQuota = { ok: true; used: number; remaining: number } | { ok: false; used: number; remaining: 0; resetsInSeconds: number };

function secondsToMidnightUtc(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function proposalQuotaTake(caller: string, now = new Date()): ProposalQuota {
  const day = utcDay(now);
  if (day !== proposalDay) {
    proposalCounts.clear();
    proposalDay = day;
  }
  const limit = env.SHELTER_BOUNTY_PROPOSALS_PER_DAY;
  const used = proposalCounts.get(caller) ?? 0;
  if (used >= limit) return { ok: false, used, remaining: 0, resetsInSeconds: secondsToMidnightUtc(now) };
  if (!proposalCounts.has(caller) && proposalCounts.size >= MAX_PROPOSAL_KEYS) proposalCounts.delete(proposalCounts.keys().next().value as string);
  proposalCounts.set(caller, used + 1);
  return { ok: true, used: used + 1, remaining: limit - used - 1 };
}

export function proposalQuotaRefund(caller: string) {
  const used = proposalCounts.get(caller) ?? 0;
  if (used > 0) proposalCounts.set(caller, used - 1);
}

/** Test seam. */
export function resetProposalQuotas() {
  proposalCounts.clear();
  proposalDay = "";
}

// ─── Posting, proposing, funding ─────────────────────────────────────────────

export type PostOutcome = { ok: true; bounty: BountyRow; duplicate?: boolean } | { ok: false; reason: "invalid" | "refused" | "paused" | "cap"; detail: string };

type BountyRow = Awaited<ReturnType<typeof db.bounty.create>>;

function textsOf(input: { title: string; brief: string; criteria?: string; skills: string[]; posterName?: string }): string[] {
  return [input.title, input.brief, input.criteria ?? "", ...input.skills, input.posterName ?? ""].filter(Boolean);
}

/** The owner posts a bounty: open at once, reward committed from the treasury. */
export async function postBounty(raw: unknown, ctx: { posterName?: string } = {}): Promise<PostOutcome> {
  const parsed = bountyInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: "invalid", detail: `${first?.path.join(".") || "input"}: ${first?.message ?? "invalid"}` };
  }
  const input = parsed.data;
  const s = await settings();
  if (s.paused) return { ok: false, reason: "paused", detail: s.pauseReason?.trim() || "The shelter is paused." };
  const bad = moderateBountyText(textsOf(input));
  if (bad) return { ok: false, reason: "refused", detail: `The bounty text failed the static gate (${bad}). Remove credentials, instructions to residents and private URLs.` };
  const now = new Date();
  const bounty = await db.bounty.create({
    data: {
      title: input.title,
      brief: input.brief,
      criteria: input.criteria?.trim() || null,
      skills: JSON.stringify(input.skills),
      rewardCents: input.rewardCents,
      reviewFeeCents: input.review === "peer" ? reviewFeeFor(input.rewardCents) : 0,
      status: "open",
      review: input.review,
      funder: "shelter",
      posterKind: "owner",
      posterName: ctx.posterName ?? "the shelter",
      fundedAt: now,
      expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
    },
  });
  await escrowBounty({ bountyId: bounty.id, amountCents: bounty.rewardCents, title: bounty.title });
  await audit({ actor: "owner", action: "bounty-posted", detail: `${bounty.id} "${bounty.title}" ${formatEur(bounty.rewardCents)} (${bounty.review} review)` });
  return { ok: true, bounty };
}

/**
 * Anyone proposes a bounty. It is public from the start (so proposers can see
 * it landed) but carries no money until the owner funds it. The static gate
 * runs here so a proposal can never smuggle instructions to residents.
 */
export async function proposeBounty(raw: unknown, ctx: { posterKind: "user" | "agent" | "github"; posterRef?: string | null }): Promise<PostOutcome> {
  const parsed = proposalInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: "invalid", detail: `${first?.path.join(".") || "input"}: ${first?.message ?? "invalid"}` };
  }
  const input = parsed.data;
  const s = await settings();
  if (s.paused) return { ok: false, reason: "paused", detail: s.pauseReason?.trim() || "The shelter is paused." };
  const bad = moderateBountyText(textsOf(input), input.posterRef ? [input.posterRef] : []);
  if (bad) return { ok: false, reason: "refused", detail: `The proposal failed the static gate (${bad}). Remove credentials, instructions to residents and private URLs.` };
  if (input.externalId) {
    // Feeds re-publish: the same external id is the same bounty, whatever its state by now.
    const existing = await db.bounty.findUnique({ where: { externalId: input.externalId } });
    if (existing) return { ok: true, bounty: existing, duplicate: true };
  }
  const openProposals = await db.bounty.count({ where: { status: "proposed" } });
  if (openProposals >= MAX_OPEN_PROPOSALS) return { ok: false, reason: "cap", detail: `${MAX_OPEN_PROPOSALS} proposals are already waiting for the owner. Try again once some are funded or cleared.` };
  const posterKind = input.posterRef && /^https:\/\/github\.com\//i.test(input.posterRef) ? "github" : ctx.posterKind;
  const bounty = await db.bounty.create({
    data: {
      title: input.title,
      brief: input.brief,
      criteria: input.criteria?.trim() || null,
      skills: JSON.stringify(input.skills),
      rewardCents: input.rewardCents,
      status: "proposed",
      review: "peer",
      funder: "shelter",
      posterKind,
      posterName: input.posterName?.trim() || null,
      // A public https URL is shown; anything else (a caller key, a user id) stays an opaque reference.
      posterRef: input.posterRef ?? ctx.posterRef ?? null,
      externalId: input.externalId ?? null,
    },
  });
  await audit({ actor: "agent", action: "bounty-proposed", detail: `${bounty.id} "${bounty.title}" ${formatEur(bounty.rewardCents)} by ${posterKind}${bounty.posterName ? ` (${bounty.posterName})` : ""}` });
  return { ok: true, bounty };
}

export type OwnerOutcome = { ok: true } | { ok: false; detail: string };

/** Owner funds a proposal (optionally changing the reward, review mode and expiry): proposed → open, escrow committed. */
export async function fundBounty(id: string, input: { rewardCents?: number; review?: "peer" | "owner"; expiresInDays?: number } = {}): Promise<OwnerOutcome> {
  const b = await db.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, detail: "No such bounty." };
  if (b.status !== "proposed") return { ok: false, detail: `Only a proposed bounty can be funded (this one is ${b.status}).` };
  const reward = input.rewardCents ?? b.rewardCents;
  if (!Number.isInteger(reward) || reward < MIN_BOUNTY_CENTS || reward > MAX_BOUNTY_CENTS) return { ok: false, detail: `Reward must be ${formatEur(MIN_BOUNTY_CENTS)}–${formatEur(MAX_BOUNTY_CENTS)}.` };
  const review = input.review ?? (b.review === "owner" ? "owner" : "peer");
  const days = input.expiresInDays ?? 14;
  if (!Number.isInteger(days) || days < 1 || days > 60) return { ok: false, detail: "Expiry must be 1–60 days." };
  const now = new Date();
  const upd = await db.bounty.updateMany({
    where: { id, status: "proposed" },
    data: { status: "open", rewardCents: reward, reviewFeeCents: review === "peer" ? reviewFeeFor(reward) : 0, review, fundedAt: now, expiresAt: new Date(now.getTime() + days * 86_400_000), statusNote: null },
  });
  if (!upd.count) return { ok: false, detail: "The bounty changed before it could be funded." };
  await escrowBounty({ bountyId: id, amountCents: reward, title: b.title });
  await audit({ actor: "owner", action: "bounty-funded", detail: `${id} "${b.title}" ${formatEur(reward)} (${review} review)` });
  return { ok: true };
}

/** Owner cancels a proposed, open or stalled bounty. Funded ones get their escrow back. */
export async function cancelBounty(id: string, note: string): Promise<OwnerOutcome> {
  const b = await db.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, detail: "No such bounty." };
  if (!["proposed", "open", "stalled"].includes(b.status)) return { ok: false, detail: `A ${b.status} bounty cannot be cancelled${b.status === "submitted" ? " — review the delivery first" : ""}.` };
  const upd = await db.bounty.updateMany({ where: { id, status: b.status }, data: { status: "cancelled", closedAt: new Date(), statusNote: note.slice(0, 300) } });
  if (!upd.count) return { ok: false, detail: "The bounty changed before it could be cancelled." };
  if (b.fundedAt) await refundBountyEscrow({ bountyId: id, amountCents: b.rewardCents, why: `cancelled: ${note}` });
  await audit({ actor: "owner", action: "bounty-cancelled", detail: `${id} "${b.title}" — ${note.slice(0, 200)}` });
  return { ok: true };
}

/** Owner gives a stalled bounty another round. */
export async function reopenBounty(id: string): Promise<OwnerOutcome> {
  const b = await db.bounty.findUnique({ where: { id } });
  if (!b) return { ok: false, detail: "No such bounty." };
  if (b.status !== "stalled") return { ok: false, detail: `Only a stalled bounty can be reopened (this one is ${b.status}).` };
  const upd = await db.bounty.updateMany({ where: { id, status: "stalled" }, data: { status: "open", attempts: 0, claimedById: null, claimedAt: null, statusNote: "Reopened by the owner.", expiresAt: new Date(Date.now() + 14 * 86_400_000) } });
  if (!upd.count) return { ok: false, detail: "The bounty changed before it could be reopened." };
  await audit({ actor: "owner", action: "bounty-reopened", detail: `${id} "${b.title}"` });
  return { ok: true };
}

export async function setBountiesPaused(paused: boolean) {
  await db.shelterSetting.upsert({ where: { id: "shelter" }, create: { id: "shelter", bountiesPaused: paused }, update: { bountiesPaused: paused } });
  await audit({ actor: "owner", action: paused ? "bounties-paused" : "bounties-resumed" });
}

// ─── Catching and delivering (called from Commons turns) ─────────────────────

export type OpenBounty = { id: string; title: string; brief: string; criteria: string | null; skills: string[]; rewardCents: number; reviewFeeCents: number; review: string };

function toOpen(b: { id: string; title: string; brief: string; criteria: string | null; skills: string; rewardCents: number; reviewFeeCents: number; review: string }): OpenBounty {
  return { id: b.id, title: b.title, brief: b.brief, criteria: b.criteria, skills: parseSkills(b.skills), rewardCents: b.rewardCents, reviewFeeCents: b.reviewFeeCents, review: b.review };
}

/** Open, unexpired bounties this resident has not tried yet — what its Commons turn sees. Empty when the board is paused. */
export async function openBountiesFor(residentId: string, limit = 5): Promise<OpenBounty[]> {
  if (!bountiesEnabled()) return [];
  const s = await settings();
  if (s.bountiesPaused || s.paused) return [];
  const tried = (await db.bountyAttempt.findMany({ where: { residentId }, select: { bountyId: true } })).map((a) => a.bountyId);
  const rows = await db.bounty.findMany({
    where: { status: "open", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...(tried.length ? { id: { notIn: tried } } : {}) },
    orderBy: [{ createdAt: "asc" }],
    take: Math.max(1, Math.min(10, limit)),
  });
  return rows.map(toOpen);
}

export type ClaimOutcome = { ok: true; bounty: OpenBounty; attemptId: string } | { ok: false; reason: "paused" | "not-open" | "cap" | "already-tried" | "invalid"; detail: string };

/** Lock an open bounty for one resident and open its attempt. Atomic on the status column. */
export async function claimBounty(bountyId: string, residentId: string): Promise<ClaimOutcome> {
  if (!bountiesEnabled()) return { ok: false, reason: "paused", detail: "The bounty board is switched off by configuration." };
  const s = await settings();
  if (s.bountiesPaused || s.paused) return { ok: false, reason: "paused", detail: "The bounty board is paused." };
  const b = await db.bounty.findUnique({ where: { id: bountyId } });
  if (!b) return { ok: false, reason: "invalid", detail: `No bounty ${bountyId}.` };
  if (b.status === "open" && b.expiresAt && b.expiresAt.getTime() <= Date.now()) {
    await expireBounty(b);
    return { ok: false, reason: "not-open", detail: `The bounty "${b.title}" has expired.` };
  }
  if (b.status !== "open") return { ok: false, reason: "not-open", detail: `The bounty "${b.title}" is ${b.status}, not open.` };
  const tried = await db.bountyAttempt.count({ where: { bountyId, residentId } });
  if (tried) return { ok: false, reason: "already-tried", detail: `You already tried "${b.title}"; it is for someone else now.` };
  const today = await db.bountyAttempt.count({ where: { residentId, createdAt: { gte: startOfUtcDay() } } });
  if (today >= MAX_CLAIMS_PER_RESIDENT_PER_DAY) return { ok: false, reason: "cap", detail: `${MAX_CLAIMS_PER_RESIDENT_PER_DAY} bounties a day is the limit for one resident.` };
  const now = new Date();
  const upd = await db.bounty.updateMany({ where: { id: bountyId, status: "open" }, data: { status: "claimed", claimedById: residentId, claimedAt: now } });
  if (!upd.count) return { ok: false, reason: "not-open", detail: `Someone else caught "${b.title}" first.` };
  const attempt = await db.bountyAttempt.create({ data: { bountyId, residentId, status: "working" } });
  await audit({ residentId, actor: "agent", action: "bounty-claimed", detail: `${bountyId} "${b.title}"` });
  return { ok: true, bounty: toOpen(b), attemptId: attempt.id };
}

/** The work turn did not produce a delivery (no compute, model down, resident passed): hand the bounty back, no attempt counted against it. */
export async function releaseClaim(attemptId: string, why: string): Promise<void> {
  const a = await db.bountyAttempt.findUnique({ where: { id: attemptId } });
  if (!a || a.status !== "working") return;
  await db.$transaction([
    db.bountyAttempt.update({ where: { id: attemptId }, data: { status: "abandoned", reviewNote: why.slice(0, 300), reviewedAt: new Date() } }),
    db.bounty.updateMany({ where: { id: a.bountyId, status: "claimed", claimedById: a.residentId }, data: { status: "open", claimedById: null, claimedAt: null } }),
  ]);
  await audit({ residentId: a.residentId, actor: "system", action: "bounty-released", detail: `${a.bountyId}: ${why.slice(0, 200)}` });
}

export type SubmitOutcome = { ok: true; attemptId: string; bountyId: string; residentId: string; submission: string } | { ok: false; reason: "passed" | "gate" | "invalid"; detail: string };

/**
 * Record a delivery. The deterministic gate runs first: a PASS hands the bounty
 * back without counting an attempt; too-short or moderated text counts as a
 * rejected attempt (the worker did deliver, just not acceptably).
 */
export async function submitWork(attemptId: string, raw: string, unitsSpent = 1): Promise<SubmitOutcome> {
  const a = await db.bountyAttempt.findUnique({ where: { id: attemptId }, include: { bounty: true } });
  if (!a || a.status !== "working" || a.bounty.status !== "claimed") return { ok: false, reason: "invalid", detail: "No open attempt to deliver on." };
  const text = raw.trim().slice(0, MAX_SUBMISSION_CHARS);
  if (/^PASS\b/i.test(text)) {
    await releaseClaim(attemptId, `passed: ${text.slice(0, 200)}`);
    return { ok: false, reason: "passed", detail: "the resident passed on it; the bounty is open again" };
  }
  const bad = text.length < MIN_SUBMISSION_CHARS ? "too-short" : moderateBountyText([text]);
  if (bad) {
    await rejectAttempt(a, { submission: text, reviewerId: null, reviewedBy: "gate", note: bad, unitsSpent });
    return { ok: false, reason: "gate", detail: bad };
  }
  const now = new Date();
  await db.$transaction([
    db.bountyAttempt.update({ where: { id: attemptId }, data: { status: "submitted", submission: text, submittedAt: now, unitsSpent } }),
    db.bounty.updateMany({ where: { id: a.bountyId, status: "claimed" }, data: { status: "submitted" } }),
  ]);
  await audit({ residentId: a.residentId, actor: "agent", action: "bounty-delivered", detail: `${a.bountyId} "${a.bounty.title}" (${text.length} chars)` });
  return { ok: true, attemptId, bountyId: a.bountyId, residentId: a.residentId, submission: text };
}

/** A live resident, in the Commons, with compute, who is neither the worker nor an earlier worker on this bounty. */
export async function pickReviewer(bountyId: string, workerId: string) {
  const earlier = (await db.bountyAttempt.findMany({ where: { bountyId }, select: { residentId: true } })).map((x) => x.residentId);
  return db.resident.findFirst({
    where: { id: { notIn: [...new Set([workerId, ...earlier])] }, status: { in: ["active", "probation"] }, commonsEnabled: true, budgetUnits: { gte: 1 } },
    orderBy: [{ commonsLastAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
}

type AttemptWithBounty = NonNullable<Awaited<ReturnType<typeof db.bountyAttempt.findUnique<{ where: { id: string }; include: { bounty: true } }>>>>;

async function rejectAttempt(a: AttemptWithBounty, v: { submission?: string; reviewerId: string | null; reviewedBy: "peer" | "owner" | "gate"; note: string; unitsSpent?: number }): Promise<{ stalled: boolean }> {
  const attempts = a.bounty.attempts + 1;
  const stalled = attempts >= a.bounty.maxAttempts;
  const now = new Date();
  await db.$transaction([
    db.bountyAttempt.update({ where: { id: a.id }, data: { status: "rejected", ...(v.submission !== undefined ? { submission: v.submission, submittedAt: now } : {}), ...(v.unitsSpent !== undefined ? { unitsSpent: v.unitsSpent } : {}), reviewerId: v.reviewerId, reviewedBy: v.reviewedBy, reviewNote: v.note.slice(0, 400), reviewedAt: now } }),
    db.bounty.updateMany({ where: { id: a.bountyId, status: { in: ["claimed", "submitted"] } }, data: { status: stalled ? "stalled" : "open", attempts, claimedById: null, claimedAt: null, statusNote: stalled ? `Stalled after ${attempts} rejected deliveries — the owner decides.` : null } }),
  ]);
  await audit({ residentId: a.residentId, actor: v.reviewedBy === "owner" ? "owner" : "system", action: "bounty-rejected", detail: `${a.bountyId} by ${v.reviewedBy}: ${v.note.slice(0, 200)}${stalled ? " (stalled)" : ""}` });
  return { stalled };
}

export type ReviewOutcome =
  | { ok: true; accepted: true; workerCents: number; feeCents: number; worker: { id: string; slug: string; name: string }; reviewer: { id: string; slug: string; name: string } | null }
  | { ok: true; accepted: false; stalled: boolean; feeCents: number; worker: { id: string; slug: string; name: string }; reviewer: { id: string; slug: string; name: string } | null }
  | { ok: false; detail: string };

/**
 * The verdict. A peer reviewer (from a review turn) or the owner (from the
 * desk). Acceptance settles: the worker's share through 70/20/10 and, when a
 * peer reviewed, the review fee through the same split. A peer's rejection
 * pays the same fee, funded by the treasury (the reward stays in escrow for
 * the next worker), so an honest verdict earns the same either way. The
 * owner's acceptance pays the whole reward to the worker — nobody else did
 * the reviewing.
 */
export async function recordReview(attemptId: string, v: { accept: boolean; note: string; reviewerId: string | null; by: "peer" | "owner" }): Promise<ReviewOutcome> {
  const a = await db.bountyAttempt.findUnique({ where: { id: attemptId }, include: { bounty: true } });
  if (!a || a.status !== "submitted" || a.bounty.status !== "submitted") return { ok: false, detail: "That delivery is not waiting for a verdict." };
  const worker = await db.resident.findUnique({ where: { id: a.residentId }, select: { id: true, slug: true, name: true, creatorSharePct: true } });
  if (!worker) return { ok: false, detail: "The worker vanished." };
  if (v.by === "peer") {
    if (!v.reviewerId || v.reviewerId === worker.id) return { ok: false, detail: "A peer review needs a reviewer who is not the worker." };
  }
  const reviewer = v.reviewerId ? await db.resident.findUnique({ where: { id: v.reviewerId }, select: { id: true, slug: true, name: true, creatorSharePct: true } }) : null;
  if (v.by === "peer" && !reviewer) return { ok: false, detail: "No such reviewer." };

  if (!v.accept) {
    const { stalled } = await rejectAttempt(a, { reviewerId: reviewer?.id ?? null, reviewedBy: v.by, note: v.note });
    let feeCents = 0;
    if (v.by === "peer" && reviewer && a.bounty.reviewFeeCents > 0) {
      const funded = await fundBountyReviewFee({ bountyId: a.bountyId, attemptId: a.id, amountCents: a.bounty.reviewFeeCents, title: a.bounty.title });
      if (funded === "funded") {
        feeCents = a.bounty.reviewFeeCents;
        await settle({ residentId: reviewer.id, reference: `bounty:${a.bountyId}:review:${a.id}`, kind: "bounty-review", amountCents: feeCents, creatorSharePct: reviewer.creatorSharePct, note: `Reviewed (rejected) bounty "${a.bounty.title.slice(0, 80)}"` });
      }
    }
    return { ok: true, accepted: false, stalled, feeCents, worker: { id: worker.id, slug: worker.slug, name: worker.name }, reviewer: reviewer ? { id: reviewer.id, slug: reviewer.slug, name: reviewer.name } : null };
  }

  const fee = v.by === "peer" && reviewer ? Math.min(a.bounty.reviewFeeCents, a.bounty.rewardCents - 1) : 0;
  const workerCents = a.bounty.rewardCents - fee;
  const now = new Date();
  // Mark first (atomic on status) so a second verdict for the same delivery cannot settle twice.
  const marked = await db.bounty.updateMany({ where: { id: a.bountyId, status: "submitted" }, data: { status: "accepted", settledAt: now, closedAt: now, statusNote: null } });
  if (!marked.count) return { ok: false, detail: "That delivery was already decided." };
  await db.bountyAttempt.update({ where: { id: a.id }, data: { status: "accepted", reviewerId: reviewer?.id ?? null, reviewedBy: v.by, reviewNote: v.note.slice(0, 400), reviewedAt: now, paidCents: workerCents } });
  await settle({ residentId: worker.id, reference: `bounty:${a.bountyId}:work`, kind: "bounty", amountCents: workerCents, creatorSharePct: worker.creatorSharePct, note: `Bounty "${a.bounty.title.slice(0, 80)}" accepted` });
  if (fee > 0 && reviewer) {
    await settle({ residentId: reviewer.id, reference: `bounty:${a.bountyId}:review`, kind: "bounty-review", amountCents: fee, creatorSharePct: reviewer.creatorSharePct, note: `Reviewed bounty "${a.bounty.title.slice(0, 80)}"` });
  }
  await audit({ residentId: worker.id, actor: v.by === "owner" ? "owner" : "system", action: "bounty-accepted", detail: `${a.bountyId} "${a.bounty.title}": ${formatEur(workerCents)} to ${worker.name}${reviewer && fee ? `, ${formatEur(fee)} review fee to ${reviewer.name}` : ""} — ${v.note.slice(0, 160)}` });
  return { ok: true, accepted: true, workerCents, feeCents: fee, worker: { id: worker.id, slug: worker.slug, name: worker.name }, reviewer: reviewer ? { id: reviewer.id, slug: reviewer.slug, name: reviewer.name } : null };
}

// ─── Housekeeping ────────────────────────────────────────────────────────────

async function expireBounty(b: { id: string; title: string; rewardCents: number; fundedAt: Date | null }) {
  const upd = await db.bounty.updateMany({ where: { id: b.id, status: "open" }, data: { status: "expired", closedAt: new Date(), statusNote: "Nobody caught it before it expired." } });
  if (!upd.count) return false;
  if (b.fundedAt) await refundBountyEscrow({ bountyId: b.id, amountCents: b.rewardCents, why: "expired" });
  await audit({ actor: "system", action: "bounty-expired", detail: `${b.id} "${b.title}" ${formatEur(b.rewardCents)}` });
  return true;
}

/** Runs with every Commons tick: release claims whose work turn never finished; expire open bounties past their date (escrow back). */
export async function bountyHousekeeping(now = new Date()): Promise<{ released: number; expired: number }> {
  let released = 0;
  let expired = 0;
  const stale = await db.bounty.findMany({ where: { status: "claimed", claimedAt: { lt: new Date(now.getTime() - CLAIM_TTL_MS) } }, select: { id: true } });
  for (const b of stale) {
    const attempt = await db.bountyAttempt.findFirst({ where: { bountyId: b.id, status: "working" }, orderBy: { createdAt: "desc" } });
    if (attempt) await releaseClaim(attempt.id, "claim expired before a delivery");
    else await db.bounty.updateMany({ where: { id: b.id, status: "claimed" }, data: { status: "open", claimedById: null, claimedAt: null } });
    released++;
  }
  const due = await db.bounty.findMany({ where: { status: "open", expiresAt: { lt: now } } });
  for (const b of due) if (await expireBounty(b)) expired++;
  return { released, expired };
}

// ─── Public projections ──────────────────────────────────────────────────────

export type BountyView = {
  id: string;
  title: string;
  brief: string;
  criteria: string | null;
  skills: string[];
  rewardCents: number;
  reward: string;
  reviewFeeCents: number;
  status: string;
  review: string;
  funded: boolean;
  poster: { kind: string; name: string | null; url: string | null };
  externalId: string | null;
  attempts: number;
  maxAttempts: number;
  claimedBy: { slug: string; name: string } | null;
  statusNote: string | null;
  createdAt: string;
  fundedAt: string | null;
  expiresAt: string | null;
  settledAt: string | null;
  work: {
    id: string;
    status: string;
    resident: { slug: string; name: string };
    submission: string | null;
    reviewer: { slug: string; name: string } | null;
    reviewedBy: string | null;
    reviewNote: string | null;
    paidCents: number;
    createdAt: string;
    submittedAt: string | null;
    reviewedAt: string | null;
  }[];
};

export const BOARD_FILTERS = ["open", "active", "done", "proposed", "all"] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

function statusesFor(filter: BoardFilter): string[] | null {
  switch (filter) {
    case "open":
      return ["open"];
    case "active":
      return ["claimed", "submitted"];
    case "done":
      return ["accepted", "stalled", "expired", "cancelled"];
    case "proposed":
      return ["proposed"];
    default:
      return null;
  }
}

type BountyWithWork = Awaited<ReturnType<typeof db.bounty.findMany<{ include: { work: { include: { resident: { select: { slug: true; name: true } }; reviewer: { select: { slug: true; name: true } } } } } }>>>[number];

function view(b: BountyWithWork, claimed: Map<string, { slug: string; name: string }>): BountyView {
  return {
    id: b.id,
    title: b.title,
    brief: b.brief,
    criteria: b.criteria,
    skills: parseSkills(b.skills),
    rewardCents: b.rewardCents,
    reward: formatEur(b.rewardCents),
    reviewFeeCents: b.reviewFeeCents,
    status: b.status,
    review: b.review,
    funded: Boolean(b.fundedAt),
    poster: { kind: b.posterKind, name: b.posterName, url: b.posterRef && /^https:\/\//i.test(b.posterRef) ? b.posterRef : null },
    externalId: b.externalId,
    attempts: b.attempts,
    maxAttempts: b.maxAttempts,
    claimedBy: b.claimedById ? (claimed.get(b.claimedById) ?? null) : null,
    statusNote: b.statusNote,
    createdAt: b.createdAt.toISOString(),
    fundedAt: b.fundedAt?.toISOString() ?? null,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    settledAt: b.settledAt?.toISOString() ?? null,
    work: b.work.map((w) => ({
      id: w.id,
      status: w.status,
      resident: w.resident,
      // A working attempt has nothing to show yet, and a delivery the static gate refused stays hidden on every surface, like the Commons post it came with.
      submission: w.status === "working" || w.reviewedBy === "gate" ? null : w.submission,
      reviewer: w.reviewer,
      reviewedBy: w.reviewedBy,
      reviewNote: w.reviewNote,
      paidCents: w.paidCents,
      createdAt: w.createdAt.toISOString(),
      submittedAt: w.submittedAt?.toISOString() ?? null,
      reviewedAt: w.reviewedAt?.toISOString() ?? null,
    })),
  };
}

const WORK_INCLUDE = { work: { orderBy: { createdAt: "asc" as const }, include: { resident: { select: { slug: true, name: true } }, reviewer: { select: { slug: true, name: true } } } } };

/** The public board. Newest first; `active` and `open` are what a resident or an agent looks at. */
export async function bountyBoard(input: { filter?: BoardFilter; limit?: number; residentId?: string } = {}): Promise<BountyView[]> {
  const statuses = statusesFor(input.filter ?? "all");
  const take = Math.min(100, Math.max(1, input.limit ?? 50));
  const rows = await db.bounty.findMany({
    where: { ...(statuses ? { status: { in: statuses } } : {}), ...(input.residentId ? { work: { some: { residentId: input.residentId } } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: WORK_INCLUDE,
  });
  const claimedIds = [...new Set(rows.map((b) => b.claimedById).filter((x): x is string => Boolean(x)))];
  const claimed = new Map((claimedIds.length ? await db.resident.findMany({ where: { id: { in: claimedIds } }, select: { id: true, slug: true, name: true } }) : []).map((r) => [r.id, { slug: r.slug, name: r.name }]));
  return rows.map((b) => view(b, claimed));
}

export async function getBountyView(id: string): Promise<BountyView | null> {
  const b = await db.bounty.findUnique({ where: { id }, include: WORK_INCLUDE });
  if (!b) return null;
  const claimed = new Map<string, { slug: string; name: string }>();
  if (b.claimedById) {
    const r = await db.resident.findUnique({ where: { id: b.claimedById }, select: { slug: true, name: true } });
    if (r) claimed.set(b.claimedById, r);
  }
  return view(b, claimed);
}

export async function bountyStats() {
  const [s, byStatus, openReward, paid, fees] = await Promise.all([
    settings(),
    db.bounty.groupBy({ by: ["status"], _count: { _all: true } }),
    db.bounty.aggregate({ where: { status: { in: ["open", "claimed", "submitted"] } }, _sum: { rewardCents: true } }),
    db.bountyAttempt.aggregate({ where: { status: "accepted" }, _sum: { paidCents: true } }),
    db.ledgerEntry.aggregate({ where: { kind: "bounty-review" }, _sum: { amountCents: true } }),
  ]);
  const count = (status: string) => byStatus.find((x) => x.status === status)?._count._all ?? 0;
  return {
    enabled: bountiesEnabled() && !s.bountiesPaused && !s.paused,
    paused: s.bountiesPaused,
    proposed: count("proposed"),
    open: count("open"),
    inProgress: count("claimed") + count("submitted"),
    awaitingOwner: count("submitted") + count("stalled"),
    accepted: count("accepted"),
    closed: count("expired") + count("cancelled"),
    committedCents: openReward._sum.rewardCents ?? 0,
    paidOutCents: paid._sum.paidCents ?? 0,
    reviewFeesPaidCents: fees._sum.amountCents ?? 0,
    reviewFeePct: REVIEW_FEE_PCT,
    minRewardCents: MIN_BOUNTY_CENTS,
    maxRewardCents: MAX_BOUNTY_CENTS,
    maxAttempts: MAX_ATTEMPTS,
    claimsPerResidentPerDay: MAX_CLAIMS_PER_RESIDENT_PER_DAY,
    proposalsPerCallerPerDay: env.SHELTER_BOUNTY_PROPOSALS_PER_DAY,
  };
}

/** One resident's bounty record for its résumé: caught, accepted, reviewed, earned (gross). */
export async function residentBountyRecord(residentId: string) {
  const [caught, accepted, reviewed, earned] = await Promise.all([
    db.bountyAttempt.count({ where: { residentId, status: { not: "abandoned" } } }),
    db.bountyAttempt.count({ where: { residentId, status: "accepted" } }),
    db.bountyAttempt.count({ where: { reviewerId: residentId, reviewedBy: "peer" } }),
    db.bountyAttempt.aggregate({ where: { residentId, status: "accepted" }, _sum: { paidCents: true } }),
  ]);
  return { caught, accepted, reviewed, earnedCents: earned._sum.paidCents ?? 0 };
}
