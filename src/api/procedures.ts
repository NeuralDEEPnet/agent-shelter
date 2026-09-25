import { db } from "@/api/db";
import { queue } from "@/api/queue";
import { machinePayments, servingOrigin } from "@/api/mppClient";
import { caller, currentUserId, ensureUserRow } from "@/api/services/auth";
import {
  BillingUnavailable,
  billingConfigured,
  confirmSponsorCheckout,
  createSponsorCheckout,
  isSponsorTier,
  processWebhook,
  signForTest,
  SPONSOR_TIERS_CENTS,
} from "@/api/services/billing";
import { LICENSES, RESIDENT_KINDS, SURRENDER_AGREEMENT, SURRENDER_AGREEMENT_VERSION } from "@/api/services/intake";
import { balances, recordPayout as recordPayoutEntry, splitCents, UNIT_PRICE_CENTS } from "@/api/services/ledger";
import { globalUnitsToday, parseAllowlist, parseSpec, runTurn, utcDay } from "@/api/services/runtime";
import { adoptionPackFor, approveResident, audit, dailyHousekeeping, hibernateResident, rejectResident, settings, submitIntake, wakeResident } from "@/api/services/shelter";
import { env } from "@/lib/env";
import { notices, ok, refuse, type Result } from "@/lib/notice";

/**
 * RPC surface. Three audiences: anyone (browse, surrender), signed-in people
 * (sponsor, adopt), the owner (approve, pause, payouts). Every expected
 * refusal is a returned notice; nothing here throws for a foreseeable reason.
 */

export async function health() {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    db: await db.$queryRaw`SELECT 1 as result`.then(() => "connected").catch(() => "disconnected"),
    env: env.VITE_NODE_ENV,
  };
}

// ─── Public ──────────────────────────────────────────────────────────────────

const PUBLIC_STATUSES = ["probation", "active", "hibernated"] as const;

function publicResident(r: {
  slug: string;
  kind: string;
  name: string;
  tagline: string;
  status: string;
  hirePriceCents: number;
  paidCalls: number;
  earnedCents: number;
  createdAt: Date;
  approvedAt: Date | null;
  toolAllowlist: string;
  license: string;
  creatorName: string;
}) {
  return {
    slug: r.slug,
    kind: r.kind,
    name: r.name,
    tagline: r.tagline,
    status: r.status,
    hirePriceCents: r.hirePriceCents,
    paidCalls: r.paidCalls,
    earnedCents: r.earnedCents,
    since: (r.approvedAt ?? r.createdAt).toISOString(),
    tools: parseAllowlist(r.toolAllowlist),
    license: r.license,
    creatorName: r.creatorName,
  };
}

export async function getShelter() {
  const [byStatus, earned, s, who, sponsors] = await Promise.all([
    db.resident.groupBy({ by: ["status"], _count: { _all: true } }),
    db.resident.aggregate({ _sum: { earnedCents: true, paidCalls: true } }),
    settings(),
    caller(),
    db.sponsorship.count({ where: { status: "active" } }),
  ]);
  const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Record<string, number>;
  const mpp = machinePayments().health();
  return {
    counts,
    residentsLive: (counts.active ?? 0) + (counts.probation ?? 0),
    hibernating: counts.hibernated ?? 0,
    waiting: (counts.submitted ?? 0) + (counts.screened ?? 0),
    earnedCents: earned._sum.earnedCents ?? 0,
    paidCalls: earned._sum.paidCalls ?? 0,
    activeSponsors: sponsors,
    paused: s.paused,
    pauseReason: s.pauseReason,
    machinePayments: mpp.state,
    sponsorTiers: [...SPONSOR_TIERS_CENTS],
    sponsorshipsConfigured: billingConfigured(),
    signedIn: Boolean(who.userId),
    owner: who.owner,
    machineOrigin: servingOrigin(),
  };
}

export async function listResidents(input?: { kind?: string; includeHibernated?: boolean }) {
  const rows = await db.resident.findMany({
    where: {
      status: { in: input?.includeHibernated === false ? ["probation", "active"] : [...PUBLIC_STATUSES] },
      ...(input?.kind && (RESIDENT_KINDS as readonly string[]).includes(input.kind) ? { kind: input.kind } : {}),
    },
    orderBy: [{ status: "asc" }, { paidCalls: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(publicResident);
}

export async function getResident(input: { slug: string }): Promise<
  Result<{
    resident: ReturnType<typeof publicResident> & { story: string; statusNote: string | null; greeting: string | null };
    evalScore: number | null;
    evalSummary: string | null;
    sponsors: string[];
    sponsorCount: number;
    adoptions: number;
    wallet: { balanceCents: number; budgetUnits: number; stipendUnits: number };
    uptime: { ok: number; failed: number };
    recentAudit: { action: string; detail: string | null; at: string }[];
    hireUrl: string;
    cardUrl: string;
    canAdopt: boolean;
    /** The caller already holds this resident's pack — show the "Bring into AiBeing" door. */
    adoptedByMe: boolean;
    mySponsorship: { id: string; status: string; amountCents: number } | null;
  }>
> {
  const r = await db.resident.findUnique({
    where: { slug: input.slug },
    include: {
      wallet: true,
      reviews: { where: { kind: "eval" }, orderBy: { createdAt: "desc" }, take: 1 },
      sponsorships: { where: { status: "active" }, select: { displayName: true } },
      _count: { select: { adoptions: true } },
      audits: { where: { action: { in: ["approved", "graduated", "hibernated", "woken", "drift"] } }, orderBy: { createdAt: "desc" }, take: 6 },
    },
  });
  if (!r || !(PUBLIC_STATUSES as readonly string[]).includes(r.status)) return refuse(notices.notFound("That resident"));
  const [hires, userId] = await Promise.all([
    db.hireCall.groupBy({ by: ["outcome"], where: { residentId: r.id }, _count: { _all: true } }),
    currentUserId(),
  ]);
  const [mine, myAdoption] = userId
    ? await Promise.all([
        db.sponsorship.findFirst({ where: { residentId: r.id, userId, status: { in: ["active", "pending", "past_due"] } }, orderBy: { createdAt: "desc" } }),
        db.adoption.findUnique({ where: { residentId_userId: { residentId: r.id, userId } } }),
      ])
    : [null, null];
  const spec = parseSpec(r.spec);
  const findings = r.reviews[0] ? (JSON.parse(r.reviews[0].findings) as { summary?: string }) : null;
  return ok({
    resident: { ...publicResident(r), story: r.story, statusNote: r.statusNote, greeting: spec?.kind === "agent" ? (spec.greeting ?? null) : null },
    evalScore: r.reviews[0]?.score ?? null,
    evalSummary: findings?.summary ?? null,
    sponsors: r.sponsorships.map((s) => s.displayName).filter((x): x is string => Boolean(x)),
    sponsorCount: r.sponsorships.length,
    adoptions: r._count.adoptions,
    wallet: { balanceCents: r.wallet?.balanceCents ?? 0, budgetUnits: r.budgetUnits, stipendUnits: r.stipendUnits },
    uptime: {
      ok: hires.find((h) => h.outcome === "ok")?._count._all ?? 0,
      failed: hires.find((h) => h.outcome === "failed")?._count._all ?? 0,
    },
    recentAudit: r.audits.map((a) => ({ action: a.action, detail: a.detail, at: a.createdAt.toISOString() })),
    hireUrl: `${servingOrigin()}/api/mpp/hire/${r.slug}`,
    cardUrl: `${servingOrigin()}/api/shelter/cards/${r.slug}.svg`,
    canAdopt: r.kind !== "mcp" && r.status !== "hibernated",
    adoptedByMe: Boolean(myAdoption),
    mySponsorship: mine ? { id: mine.id, status: mine.status, amountCents: mine.amountCents } : null,
  });
}

export async function getAgreement() {
  return { text: SURRENDER_AGREEMENT, version: SURRENDER_AGREEMENT_VERSION, licenses: [...LICENSES], kinds: [...RESIDENT_KINDS], split: splitCents(100) };
}

/** The web door. Sign-in required so the surrenderer is accountable; the HTTP/MCP doors are anonymous by design. */
export async function surrender(input: unknown): Promise<Result<{ slug: string; residentId: string; checks: { id: string; ok: boolean; detail: string }[] }>> {
  const userId = await currentUserId();
  if (!userId) return refuse(notices.signIn());
  await ensureUserRow(userId);
  const recent = await db.resident.count({ where: { surrenderedBy: userId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (recent >= 5) return refuse(notices.quota("Five intakes an hour is the limit for one account. Come back in a bit."));
  const out = await submitIntake(input, { surrenderedBy: userId, actor: "agent", enqueue: (id) => queue.screenResident({ residentId: id }) });
  if (!out.ok) {
    if (out.reason === "paused") return refuse(notices.paused(out.detail));
    return refuse({ kind: "invalid", title: out.reason === "refused" ? "Refused at the door" : "Check the form", message: out.detail });
  }
  return ok({ slug: out.slug, residentId: out.residentId, checks: out.checks }, [notices.info("Checked in", "Screening is running. The owner approves every resident by hand — you can watch the status on the résumé page.")]);
}

export async function mySurrenders() {
  const userId = await currentUserId();
  if (!userId) return [] as { slug: string; name: string; kind: string; status: string; statusNote: string | null; createdAt: string }[];
  const rows = await db.resident.findMany({ where: { surrenderedBy: userId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, status: r.status, statusNote: r.statusNote, createdAt: r.createdAt.toISOString() }));
}

// ─── Sponsor / adopt ─────────────────────────────────────────────────────────

export async function startSponsorship(input: { slug: string; cents: number; displayName?: string }): Promise<Result<{ url: string; sponsorshipId: string }>> {
  const userId = await currentUserId();
  if (!userId) return refuse(notices.signIn());
  if (!isSponsorTier(input.cents)) return refuse(notices.invalid("Pick one of the sponsorship amounts."));
  if (!billingConfigured()) return refuse(notices.unavailable("Sponsorships are not switched on yet."));
  const r = await db.resident.findUnique({ where: { slug: input.slug } });
  if (!r || !(PUBLIC_STATUSES as readonly string[]).includes(r.status)) return refuse(notices.notFound("That resident"));
  await ensureUserRow(userId);
  const displayName = input.displayName?.trim().slice(0, 40) || null;
  const row = await db.sponsorship.create({ data: { residentId: r.id, userId, amountCents: input.cents, displayName } });
  try {
    const session = await createSponsorCheckout({
      sponsorshipId: row.id,
      residentId: r.id,
      residentName: r.name,
      userId,
      cents: input.cents,
      successUrl: `${servingOrigin()}/sponsor/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${servingOrigin()}/r/${encodeURIComponent(r.slug)}`,
    });
    await db.sponsorship.update({ where: { id: row.id }, data: { checkoutSessionId: session.id } });
    return ok({ url: session.url, sponsorshipId: row.id });
  } catch (error) {
    await db.sponsorship.delete({ where: { id: row.id } }).catch(() => undefined);
    if (error instanceof BillingUnavailable) return refuse(notices.unavailable(error.message));
    throw error;
  }
}

export async function confirmSponsorship(input: { sessionId: string }): Promise<Result<{ status: string; slug: string | null }>> {
  const userId = await currentUserId();
  if (!userId) return refuse(notices.signIn());
  try {
    const out = await confirmSponsorCheckout({ sessionId: input.sessionId, userId });
    if (!out.ok) return refuse(notices.invalid(out.detail));
    const row = await db.sponsorship.findFirst({ where: { checkoutSessionId: input.sessionId }, include: { resident: { select: { slug: true, name: true } } } });
    return ok({ status: out.status, slug: row?.resident.slug ?? null }, out.status === "active" ? [notices.info("Thank you", `${row?.resident.name ?? "The resident"} has a sponsor. 70 % of your support goes straight into its wallet.`)] : []);
  } catch (error) {
    if (error instanceof BillingUnavailable) return refuse(notices.unavailable(error.message));
    throw error;
  }
}

export async function mySponsorships() {
  const userId = await currentUserId();
  if (!userId) return [] as { id: string; status: string; amountCents: number; resident: { slug: string; name: string }; since: string }[];
  const rows = await db.sponsorship.findMany({ where: { userId }, include: { resident: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" } });
  return rows.map((s) => ({ id: s.id, status: s.status, amountCents: s.amountCents, resident: s.resident, since: s.createdAt.toISOString() }));
}

/**
 * Adoption: a portable copy. Mind residents export the exact `aibeing-mind/1`
 * pack they arrived with; agent residents export a `shelter-agent/1` pack.
 * Free; recorded once per person. The resident itself stays in the shelter.
 */
export async function adoptResident(input: { slug: string }): Promise<Result<{ format: string; filename: string; pack: unknown; already: boolean }>> {
  const userId = await currentUserId();
  if (!userId) return refuse(notices.signIn());
  const r = await db.resident.findUnique({ where: { slug: input.slug } });
  if (!r || !(PUBLIC_STATUSES as readonly string[]).includes(r.status)) return refuse(notices.notFound("That resident"));
  if (r.status === "hibernated") return refuse(notices.unavailable(`${r.name} is hibernating. Sponsor it to wake it, then adopt.`));
  const spec = parseSpec(r.spec);
  if (!spec || spec.kind === "mcp") return refuse(notices.unavailable("MCP servers are hosted elsewhere and cannot be adopted as a copy — hire them instead."));
  await ensureUserRow(userId);
  const adoption = adoptionPackFor(r, spec);
  const pack = adoption.pack;
  const packJson = JSON.stringify(pack);
  const packHash = (await import("node:crypto")).createHash("sha256").update(packJson).digest("hex");
  const existing = await db.adoption.findUnique({ where: { residentId_userId: { residentId: r.id, userId } } });
  if (!existing) {
    await db.adoption.create({ data: { residentId: r.id, userId, packHash } });
    await audit({ residentId: r.id, actor: "sponsor", action: "adopted" });
  }
  return ok({ format: adoption.format, filename: adoption.filename, pack, already: Boolean(existing) }, [
    notices.info(existing ? "Already yours" : "Adopted", spec.kind === "mind" ? "This is an AiBeing-compatible Mind pack. Use \"Bring into AiBeing\" to install it on one of your AiBeings." : "A portable copy of the agent's prompt, skills and tool declarations."),
  ]);
}

// ─── Owner ───────────────────────────────────────────────────────────────────

async function requireOwner(): Promise<{ ok: true; userId: string } | { ok: false; notice: ReturnType<typeof notices.signIn> }> {
  const who = await caller();
  if (!who.userId) return { ok: false, notice: notices.signIn() };
  if (!who.owner) return { ok: false, notice: notices.forbidden() };
  return { ok: true, userId: who.userId };
}

export async function adminOverview(): Promise<
  Result<{
    settings: { paused: boolean; pauseReason: string | null; autoApprove: boolean };
    queue: {
      id: string;
      slug: string;
      name: string;
      kind: string;
      status: string;
      tagline: string;
      story: string;
      creatorName: string;
      creatorContact: string;
      license: string;
      createdAt: string;
      hirePriceCents: number;
      stipendUnits: number;
      tools: string[];
      reviews: { kind: string; passed: boolean; score: number | null; findings: unknown; createdAt: string }[];
      driftDetectedAt: string | null;
    }[];
    live: { id: string; slug: string; name: string; kind: string; status: string; budgetUnits: number; stipendUnits: number; walletCents: number; paidCalls: number; earnedCents: number; todayUnits: number; todayRefunds: number; todayInjections: number; lastActiveAt: string | null; probationUntil: string | null }[];
    anomalies: string[];
    totals: { shelterCents: number; globalUnitsToday: number; globalUnitsCap: number };
    machine: { state: string; detail: string; mode: string | null; key: string | null; profileId: string | null; origin: string };
    billing: { configured: boolean; webhookUrl: string; webhookSecretSet: boolean };
    recentAudit: { action: string; actor: string; detail: string | null; resident: string | null; at: string }[];
  }>
> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const day = utcDay();
  const [s, queueRows, liveRows, usage, audits, bal, globalUnits] = await Promise.all([
    settings(),
    db.resident.findMany({ where: { status: { in: ["submitted", "screened"] } }, include: { reviews: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "asc" } }),
    db.resident.findMany({ where: { status: { in: ["probation", "active", "hibernated"] } }, include: { wallet: true }, orderBy: [{ status: "asc" }, { paidCalls: "desc" }] }),
    db.dailyUsage.findMany({ where: { day } }),
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { resident: { select: { name: true } } } }),
    balances(),
    globalUnitsToday(),
  ]);
  const usageBy = new Map(usage.map((u) => [u.residentId, u]));
  const anomalies: string[] = [];
  for (const r of liveRows) {
    const u = usageBy.get(r.id);
    if (!u) continue;
    if (u.injections >= 3) anomalies.push(`${r.name}: ${u.injections} injection-shaped questions today`);
    if (u.refunds >= 2) anomalies.push(`${r.name}: ${u.refunds} refunded/failed calls today`);
    if (u.unitsSpent >= r.stipendUnits * 3) anomalies.push(`${r.name}: spent ${u.unitsSpent} units today (3× its stipend)`);
  }
  if (globalUnits >= env.SHELTER_GLOBAL_DAILY_UNITS * 0.8) anomalies.push(`Shelter-wide compute at ${globalUnits}/${env.SHELTER_GLOBAL_DAILY_UNITS} units today`);
  const pendingRefunds = await db.machinePayment.count({ where: { status: "refund_pending" } });
  if (pendingRefunds) anomalies.push(`${pendingRefunds} refund(s) pending your hand (restricted key lacks Refunds: write?)`);
  const mpp = machinePayments().health();
  return ok({
    settings: { paused: s.paused, pauseReason: s.pauseReason, autoApprove: s.autoApprove },
    queue: queueRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      status: r.status,
      tagline: r.tagline,
      story: r.story,
      creatorName: r.creatorName,
      creatorContact: r.creatorContact,
      license: r.license,
      createdAt: r.createdAt.toISOString(),
      hirePriceCents: r.hirePriceCents,
      stipendUnits: r.stipendUnits,
      tools: parseAllowlist(r.toolAllowlist),
      reviews: r.reviews.map((v) => ({ kind: v.kind, passed: v.passed, score: v.score, findings: JSON.parse(v.findings) as unknown, createdAt: v.createdAt.toISOString() })),
      driftDetectedAt: r.driftDetectedAt?.toISOString() ?? null,
    })),
    live: liveRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      status: r.status,
      budgetUnits: r.budgetUnits,
      stipendUnits: r.stipendUnits,
      walletCents: r.wallet?.balanceCents ?? 0,
      paidCalls: r.paidCalls,
      earnedCents: r.earnedCents,
      todayUnits: usageBy.get(r.id)?.unitsSpent ?? 0,
      todayRefunds: usageBy.get(r.id)?.refunds ?? 0,
      todayInjections: usageBy.get(r.id)?.injections ?? 0,
      lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
      probationUntil: r.probationUntil?.toISOString() ?? null,
    })),
    anomalies,
    totals: { shelterCents: bal.shelterCents, globalUnitsToday: globalUnits, globalUnitsCap: env.SHELTER_GLOBAL_DAILY_UNITS },
    machine: { state: mpp.state, detail: mpp.detail, mode: mpp.mode, key: mpp.key, profileId: mpp.profileId, origin: servingOrigin() },
    billing: { configured: billingConfigured(), webhookUrl: `${env.VITE_ROOT_URL}/api/webhooks/app/${env.VITE_APP_ID}/onStripeWebhook`, webhookSecretSet: Boolean(env.STRIPE_WEBHOOK_SECRET) },
    recentAudit: audits.map((a) => ({ action: a.action, actor: a.actor, detail: a.detail, resident: a.resident?.name ?? null, at: a.createdAt.toISOString() })),
  });
}

export async function approve(input: { residentId: string; hirePriceCents?: number; stipendUnits?: number; note?: string }): Promise<Result<{ status: string }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const out = await approveResident(input.residentId, { actor: "owner", hirePriceCents: input.hirePriceCents, stipendUnits: input.stipendUnits, note: input.note });
  if (!out.ok) return refuse(notices.invalid(out.detail));
  return ok({ status: "probation" }, [notices.info("Approved", "On probation for 7 days / 50 paid calls; every hire is sampled to you until then.")]);
}

export async function reject(input: { residentId: string; note: string }): Promise<Result<{ status: string }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const out = await rejectResident(input.residentId, input.note || "Rejected by the owner.");
  if (!out.ok) return refuse(notices.invalid(out.detail));
  return ok({ status: "rejected" });
}

export async function hibernate(input: { residentId: string; note?: string }): Promise<Result<{ status: string }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const out = await hibernateResident(input.residentId, "owner", input.note || "Hibernated by the owner.");
  if (!out.ok) return refuse(notices.invalid(out.detail));
  return ok({ status: "hibernated" }, [notices.info("Hibernating", "Kept, not running. Wake it any time.")]);
}

export async function wake(input: { residentId: string; note?: string }): Promise<Result<{ status: string }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const out = await wakeResident(input.residentId, "owner", input.note || "Woken by the owner.");
  if (!out.ok) return refuse(notices.invalid(out.detail));
  return ok({ status: "active" });
}

export async function setPause(input: { paused: boolean; reason?: string }): Promise<Result<{ paused: boolean }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  await db.shelterSetting.upsert({ where: { id: "shelter" }, create: { id: "shelter", paused: input.paused, pauseReason: input.reason ?? null }, update: { paused: input.paused, pauseReason: input.reason ?? null } });
  await audit({ actor: "owner", action: input.paused ? "paused" : "resumed", detail: input.reason });
  return ok({ paused: input.paused });
}

export async function probationSamples(input?: { residentId?: string; limit?: number }): Promise<Result<{ id: string; resident: string; question: string; answer: string | null; outcome: string; paid: boolean; at: string }[]>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const rows = await db.hireCall.findMany({
    where: { ...(input?.residentId ? { residentId: input.residentId } : {}), sampled: true },
    include: { resident: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(input?.limit ?? 40, 200),
  });
  return ok(rows.map((h) => ({ id: h.id, resident: h.resident.name, question: h.question, answer: h.answer, outcome: h.outcome, paid: Boolean(h.paymentId), at: h.createdAt.toISOString() })));
}

/** Owner tries a resident before (or after) approving. Costs shelter units, no payment. */
export async function ownerTestTurn(input: { residentId: string; question: string }): Promise<Result<{ answer: string; unitsSpent: number; latencyMs: number; toolUsed: string | null }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const turn = await runTurn({ residentId: input.residentId, question: input.question, source: "owner-test", skipStatusGate: true });
  if (!turn.ok) {
    const kind = turn.reason === "budget" || turn.reason === "global" ? notices.quota(turn.detail) : turn.reason === "paused" ? notices.paused(turn.detail) : notices.unavailable(turn.detail);
    return refuse(kind);
  }
  await db.hireCall.create({ data: { residentId: input.residentId, question: input.question, answer: turn.answer, outcome: "ok", latencyMs: turn.latencyMs, costUnits: turn.unitsSpent, sampled: false } });
  return ok({ answer: turn.answer, unitsSpent: turn.unitsSpent, latencyMs: turn.latencyMs, toolUsed: turn.toolUsed });
}

export async function payouts(): Promise<Result<{ shelterCents: number; rows: { residentId: string; slug: string; name: string; creatorName: string; creatorContact: string; creatorOwedCents: number; residentWalletCents: number; residentPaidOutCents: number }[]; unitPriceCents: number }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const bal = await balances();
  const ids = [...bal.perResident.keys()];
  const residents = await db.resident.findMany({ where: { id: { in: ids } }, include: { wallet: true } });
  return ok({
    shelterCents: bal.shelterCents,
    unitPriceCents: UNIT_PRICE_CENTS,
    rows: residents.map((r) => ({
      residentId: r.id,
      slug: r.slug,
      name: r.name,
      creatorName: r.creatorName,
      creatorContact: r.creatorContact,
      creatorOwedCents: bal.perResident.get(r.id)?.creator ?? 0,
      residentWalletCents: r.wallet?.balanceCents ?? 0,
      residentPaidOutCents: r.wallet?.paidOutCents ?? 0,
    })),
  });
}

export async function recordPayout(input: { residentId: string; party: "creator" | "resident"; amountCents: number; note: string }): Promise<Result<{ recorded: boolean }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const out = await recordPayoutEntry({ residentId: input.residentId, party: input.party, amountCents: input.amountCents, note: input.note, reference: `payout:${input.party}:${input.residentId}:${Date.now()}` });
  if (out.outcome !== "recorded") return refuse(notices.invalid(out.outcome === "invalid" ? "Amount must be a positive whole number of cents." : "That payout was already recorded."));
  await audit({ residentId: input.residentId, actor: "owner", action: "payout", detail: `${input.party} ${input.amountCents}c — ${input.note}` });
  return ok({ recorded: true });
}

// ─── Outreach (drafts only — phase 2 records approval, sends nothing) ────────

export type OutreachDraft = {
  id: string;
  repo: string;
  url: string;
  stars: number;
  license: string;
  lastPush: string;
  staleDays: number;
  archived: boolean;
  fit: string;
  hosting: string;
  description: string;
  channel: string;
  issueTitle: string;
  message: string;
  draftPath: string;
};

async function loadOutreachDrafts(): Promise<{ generatedAt: string; source: string; surrenderUrl: string; candidates: OutreachDraft[] }> {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  try {
    const raw = await readFile(resolve(process.cwd(), "docs/outreach/outreach.json"), "utf8");
    const parsed = JSON.parse(raw) as { generatedAt?: string; source?: string; surrenderUrl?: string; candidates?: OutreachDraft[] };
    return {
      generatedAt: parsed.generatedAt ?? "",
      source: parsed.source ?? "",
      surrenderUrl: parsed.surrenderUrl ?? "",
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    };
  } catch {
    return { generatedAt: "", source: "", surrenderUrl: "", candidates: [] };
  }
}

/** Owner: the graveyard drafts with their approval state. Reads docs/outreach/outreach.json; nothing is sent from here. */
export async function outreachDrafts(): Promise<
  Result<{ generatedAt: string; source: string; sendingEnabled: false; drafts: (OutreachDraft & { approved: boolean; approvedAt: string | null; note: string | null })[] }>
> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const [file, approvals] = await Promise.all([loadOutreachDrafts(), db.outreachApproval.findMany()]);
  const byId = new Map(approvals.map((a) => [a.id, a]));
  return ok({
    generatedAt: file.generatedAt,
    source: file.source,
    sendingEnabled: false,
    drafts: file.candidates.map((c) => {
      const a = byId.get(c.id);
      return { ...c, approved: Boolean(a), approvedAt: a?.approvedAt.toISOString() ?? null, note: a?.note ?? null };
    }),
  });
}

/** Owner: record (or withdraw) approval to send one draft. Records only — the send phase is not built. */
export async function setOutreachApproval(input: { id: string; approved: boolean; note?: string }): Promise<Result<{ id: string; approved: boolean }>> {
  const gate = await requireOwner();
  if (!gate.ok) return refuse(gate.notice);
  const file = await loadOutreachDrafts();
  const draft = file.candidates.find((c) => c.id === input.id);
  if (!draft) return refuse(notices.notFound("That draft"));
  if (input.approved) {
    await db.outreachApproval.upsert({
      where: { id: draft.id },
      create: { id: draft.id, repo: draft.repo, approvedBy: gate.userId, note: input.note?.slice(0, 300) ?? null },
      update: { note: input.note?.slice(0, 300) ?? null },
    });
    await audit({ actor: "owner", action: "outreach-approved", detail: `${draft.repo} (recorded only; sending is a later phase)` });
  } else {
    await db.outreachApproval.deleteMany({ where: { id: draft.id } });
    await audit({ actor: "owner", action: "outreach-withdrawn", detail: draft.repo });
  }
  return ok({ id: draft.id, approved: input.approved }, [
    notices.info(input.approved ? "Approval recorded" : "Approval withdrawn", input.approved ? `${draft.repo} is marked approved. Nothing was sent — sending is a later phase.` : `${draft.repo} is back to draft.`),
  ]);
}

// ─── Cron + webhook + agent-only ─────────────────────────────────────────────

/** Daily cron (app.config.json → `shelterDaily`): stipends, hibernate the broke-and-idle, MCP drift re-checks. */
export async function shelterDaily() {
  const out = await dailyHousekeeping();
  console.log(`[housekeeping] ${JSON.stringify(out)}`);
  return out;
}

/** Stripe webhook. Stripe is not a native connector → signature verified here on the raw body. Returns, never throws. */
export async function onStripeWebhook(input: { body: string; headers: Record<string, string | string[]> }) {
  const outcome = await processWebhook(input);
  console.log(`[billing] webhook ${outcome.eventId ?? "?"} → ${outcome.outcome}: ${outcome.detail}`);
  return outcome;
}

/** Agent-only: push a locally signed event through the real webhook path. */
export async function _simulateWebhook(input: { event: Record<string, unknown> }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, detail: "STRIPE_WEBHOOK_SECRET not set" };
  const body = JSON.stringify(input.event);
  return onStripeWebhook({ body, headers: { "stripe-signature": signForTest(body, secret) } });
}

/** Agent-only: run the screening job inline (no queue) for a resident. */
export async function _screenNow(input: { residentId: string }) {
  const { screenResident } = await import("@/api/services/shelter");
  return screenResident(input.residentId);
}
