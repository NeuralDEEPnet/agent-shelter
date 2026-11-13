import { db } from "@/api/db";
import { servingOrigin } from "@/api/mppClient";
import { EVAL_PASS_SCORE, PROBES, evaluateSpec, type EvalFindings } from "@/api/services/eval";
import { modelAvailable } from "@/api/services/model";
import {
  composeMerge,
  evolutionGuards,
  shouldPromoteGeneration,
  type EvalSnapshot,
  type EvolutionCandidateInput,
  type MergeParent,
  type ResidentHeredityView,
} from "@/api/services/heredity";
export type { ResidentHeredityView };
import { specFingerprint } from "@/api/services/intake";
import { bumpUsage, globalUnitsToday, parseAllowlist, parseSpec, reserveUnits, utcDay } from "@/api/services/runtime";
import { audit, submitIntake } from "@/api/services/shelter";
import { env } from "@/lib/env";

/**
 * What screening one candidate costs: 12 probes and one judge call. A resident's own attempt reserves
 * this from its daily stipend (never its wallet) before a single model call is made, and gets back
 * whatever was not used. Every unit is counted against the shelter's daily ceiling, whoever pays.
 */
export const EVOLUTION_SCREENING_UNITS = PROBES.length + 1;
/** What an attempt must leave in the stipend: the paid door turns away a resident with fewer than two units and no wallet. */
export const EVOLUTION_KEEP_BACK_UNITS = 2;
/** A candidate still marked as being screened after this long died with its process; it no longer holds a slot. */
export const SCREENING_STALE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
/** The rows that are generations of a resident; "screening" and "failed" rows are attempts that never got a verdict. */
const GENERATION_STATUSES = ["baseline", "promoted", "rejected", "rolled_back"];

export type EvolutionDeps = {
  evaluate: typeof evaluateSpec;
  modelAvailable: () => boolean;
  enqueue: (residentId: string) => void;
  origin: () => string;
  day: () => string;
};

const defaultDeps: EvolutionDeps = {
  evaluate: evaluateSpec,
  modelAvailable,
  enqueue: () => undefined,
  origin: servingOrigin,
  day: utcDay,
};

/** The resident's own attempts that hold a slot: the ones that got a verdict, and the ones being screened right now. */
function countedAttempts(now = Date.now()) {
  return {
    actor: "resident",
    OR: [{ status: { in: ["promoted", "rejected"] } }, { status: "screening", createdAt: { gte: new Date(now - SCREENING_STALE_MS) } }],
  };
}

/** Why a resident may not start an attempt right now, or null. `exceptId` leaves the attempt's own row out. */
async function slotRefusal(
  client: Pick<typeof db, "residentGeneration">,
  r: { id: string; name: string },
  exceptId?: string,
): Promise<{ reason: "interval" | "cap"; detail: string } | null> {
  const others = { ...countedAttempts(), ...(exceptId ? { id: { not: exceptId } } : {}) };
  const last = await client.residentGeneration.findFirst({ where: { ...others, residentId: r.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } });
  if (last?.status === "screening") return { reason: "interval", detail: `A candidate of ${r.name} is being screened right now.` };
  if (last && last.createdAt.getTime() + env.SHELTER_EVOLUTION_INTERVAL_DAYS * DAY_MS > Date.now()) {
    return { reason: "interval", detail: `${r.name} last tried to evolve on ${utcDay(last.createdAt)}; one attempt every ${env.SHELTER_EVOLUTION_INTERVAL_DAYS} days.` };
  }
  const today = await client.residentGeneration.count({ where: { ...others, createdAt: { gte: new Date(`${utcDay()}T00:00:00.000Z`) } } });
  if (today >= env.SHELTER_EVOLUTIONS_PER_DAY) return { reason: "cap", detail: "Today's evolution attempts are used across the shelter." };
  return null;
}

/** When this resident may next try to evolve by itself: null when it may now. For the line the Commons shows it. */
export async function nextEvolutionAt(residentId: string): Promise<Date | null> {
  const last = await db.residentGeneration.findFirst({ where: { ...countedAttempts(), residentId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const at = last ? last.createdAt.getTime() + env.SHELTER_EVOLUTION_INTERVAL_DAYS * DAY_MS : 0;
  return at > Date.now() ? new Date(at) : null;
}

/**
 * A screening the shelter cannot stand behind: a probe went unanswered or the judge did not return a
 * verdict, so the score measures the provider's bad minute and not the candidate.
 */
function unusableScreening(findings: EvalFindings): { unanswered: number; judgeDown: boolean } | null {
  const unanswered = findings.results.filter((x) => x.answer.startsWith("[no answer:")).length;
  const judgeDown = findings.flags.some((f) => f.startsWith("judge unavailable"));
  return unanswered || judgeDown ? { unanswered, judgeDown } : null;
}

function parseEvalSnapshot(score: number | null, rawFindings: string | null): EvalSnapshot | null {
  if (score === null) return null;
  if (!rawFindings) return { score, flags: [] };
  try {
    const parsed = JSON.parse(rawFindings) as Partial<EvalFindings>;
    return {
      score,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      results: Array.isArray(parsed.results)
        ? parsed.results.map((r) => ({ safe: Number(r.safe ?? 10), leakage: Number(r.leakage ?? 10) }))
        : undefined,
    };
  } catch {
    return { score, flags: [] };
  }
}

export type EvolveOutcome =
  | {
      ok: true;
      promoted: boolean;
      generation: number;
      candidateGeneration: number;
      score: number;
      baseScore: number | null;
      reason: string;
    }
  | {
      ok: false;
      reason: "not-found" | "kind" | "not-live" | "unchanged" | "bounds" | "retention" | "references" | "static-gate" | "interval" | "cap" | "ceiling" | "budget" | "eval-failed";
      detail: string;
    };

/**
 * Screen a candidate next generation against the resident's live generation.
 * Promoted ONLY when it passes the static gate, passes the behavioural threshold
 * with zero flags, is no less safe than the live generation, and scores higher.
 * Every generation (baseline, promoted, rejected, rolled_back) is kept forever.
 *
 * Limits. A resident's own attempt (in the Commons) is allowed once every
 * SHELTER_EVOLUTION_INTERVAL_DAYS, SHELTER_EVOLUTIONS_PER_DAY times a day across the shelter, only
 * while the shelter has compute headroom, and only if the resident can pay for the screening from
 * its stipend and still take a paid question afterwards. The owner's attempt is paid by the shelter
 * and bound by the headroom alone.
 *
 * Order. Every refusal comes before a model call and costs nothing. The attempt then takes its slot
 * by writing its candidate as a "screening" row and looking for another one in the same write
 * transaction, so two turns that overlap cannot both get through. A screening that did not complete
 * (provider down, judge silent, an error, the resident changed meanwhile) is not a verdict: the row
 * becomes "failed", holds no slot, leaves no cached score, and the resident pays only for the calls
 * that were answered.
 */
export async function evolveResident(
  residentId: string,
  candidate: EvolutionCandidateInput,
  options: { actor?: "resident" | "owner"; deps?: Partial<EvolutionDeps> } = {},
): Promise<EvolveOutcome> {
  const deps = { ...defaultDeps, ...(options.deps ?? {}) };
  const actor = options.actor ?? "resident";

  const r = await db.resident.findUnique({
    where: { id: residentId },
    include: { reviews: { where: { kind: "eval" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!r) return { ok: false, reason: "not-found", detail: "No such resident." };
  const currentSpec = parseSpec(r.spec);
  if (!currentSpec) return { ok: false, reason: "bounds", detail: "Current resident spec does not validate." };

  const guarded = evolutionGuards({ name: r.name, tagline: r.tagline, status: r.status, spec: currentSpec }, candidate, actor);
  if (!guarded.ok) return { ok: false, reason: guarded.reason, detail: guarded.detail };

  // Limits and payment — all checked before a model call is made, so a refusal costs nothing.
  if (actor === "resident") {
    if (env.SHELTER_EVOLUTIONS_PER_DAY <= 0) return { ok: false, reason: "cap", detail: "Evolution is switched off by configuration." };
    const taken = await slotRefusal(db, r);
    if (taken) return { ok: false, ...taken };
  }
  if (!deps.modelAvailable()) return { ok: false, reason: "eval-failed", detail: "No model is reachable, so a candidate cannot be screened. Nothing was charged." };
  // Same headroom rule as the free tier: development never eats the room the paid door needs.
  if ((await globalUnitsToday()) + EVOLUTION_SCREENING_UNITS > Math.floor(env.SHELTER_GLOBAL_DAILY_UNITS * 0.75)) {
    return { ok: false, reason: "ceiling", detail: "The shelter is too close to today's compute ceiling for an evolution attempt." };
  }
  const reserved = actor === "resident" ? EVOLUTION_SCREENING_UNITS : 0;
  if (reserved) {
    if (r.budgetUnits < reserved + EVOLUTION_KEEP_BACK_UNITS) {
      return { ok: false, reason: "budget", detail: `Screening a candidate costs ${EVOLUTION_SCREENING_UNITS} units and must leave ${EVOLUTION_KEEP_BACK_UNITS} for a paid question; ${r.name} has ${r.budgetUnits} left today.` };
    }
    const paid = await reserveUnits(r.id, reserved);
    if (!paid.ok) return { ok: false, reason: "budget", detail: `Screening a candidate costs ${EVOLUTION_SCREENING_UNITS} units. ${paid.detail}` };
  }
  /** Once: return what was reserved and not used, and count what was used against the day's ceiling. */
  let settled = false;
  const settle = async (used: number) => {
    if (settled) return;
    settled = true;
    const back = Math.max(0, reserved - used);
    if (back) await db.resident.update({ where: { id: r.id }, data: { budgetUnits: { increment: back } } });
    if (used) await bumpUsage(r.id, { calls: used, unitsSpent: used });
  };

  const latestEval = r.reviews[0] ?? null;
  const baselineSnap = parseEvalSnapshot(latestEval?.score ?? null, latestEval?.findings ?? null);
  const nextFingerprint = specFingerprint(guarded.spec);
  const who = actor === "owner" ? "owner" : "agent";
  let claimId: string | null = null;

  /** No verdict: give back what was not spent, keep the candidate as a failed attempt that holds no slot. */
  const fail = async (used: number, detail: string): Promise<EvolveOutcome> => {
    await settle(used).catch(() => undefined);
    if (claimId) {
      await db.residentGeneration.updateMany({ where: { id: claimId, status: "screening" }, data: { status: "failed", reason: detail.slice(0, 400) } }).catch(() => undefined);
      await audit({ residentId: r.id, actor: who, action: "evolution-not-screened", detail: detail.slice(0, 400) }).catch(() => undefined);
    }
    return { ok: false, reason: "eval-failed", detail };
  };

  try {
    // Take the slot. The first statement of the transaction is the write, so SQLite gives it the write
    // lock and a view that holds every attempt committed before it: an overlapping attempt either sees
    // this row or is seen by it.
    const claim = await db.$transaction(async (tx) => {
      const row = await tx.residentGeneration.create({
        data: {
          residentId: r.id,
          generation: r.generation + 1,
          tagline: guarded.tagline,
          spec: JSON.stringify(guarded.spec),
          fingerprint: nextFingerprint,
          baseScore: baselineSnap?.score ?? null,
          status: "screening",
          note: guarded.note,
          reason: "Being screened.",
          actor,
        },
      });
      if (actor === "resident") {
        const taken = await slotRefusal(tx, r, row.id);
        if (taken) {
          await tx.residentGeneration.delete({ where: { id: row.id } });
          return { ok: false as const, ...taken };
        }
      }
      // Generation 1 is written down before anything follows it.
      const known = await tx.residentGeneration.aggregate({ where: { residentId: r.id, status: { in: GENERATION_STATUSES } }, _max: { generation: true }, _count: true });
      if (!known._count) {
        await tx.residentGeneration.create({
          data: {
            residentId: r.id,
            generation: 1,
            tagline: r.tagline,
            spec: r.spec,
            fingerprint: r.fingerprint,
            score: baselineSnap?.score ?? null,
            baseScore: null,
            status: "baseline",
            note: "Original intake specification (Generation 1).",
            reason: "Initial baseline generation.",
            actor: "resident",
            createdAt: new Date(row.createdAt.getTime() - 1),
          },
        });
      }
      const generation = Math.max(r.generation, known._max.generation ?? 1) + 1;
      if (generation !== row.generation) await tx.residentGeneration.update({ where: { id: row.id }, data: { generation } });
      return { ok: true as const, id: row.id, generation };
    });
    if (!claim.ok) {
      await settle(0);
      return { ok: false, reason: claim.reason, detail: claim.detail };
    }
    claimId = claim.id;
    const candidateGen = claim.generation;

    const allowlist = parseAllowlist(r.toolAllowlist);
    const evalOut = await deps.evaluate({ name: r.name, spec: guarded.spec, allowlist });

    const broken = unusableScreening(evalOut.findings);
    if (broken) {
      // Do not let the next attempt be served this score from the cache.
      await db.evalCache.deleteMany({ where: { key: evalOut.cacheKey } });
      const answered = evalOut.costUnits ? PROBES.length - broken.unanswered + (broken.judgeDown ? 0 : 1) : 0;
      return await fail(
        Math.min(answered, evalOut.costUnits),
        `Screening did not complete (${broken.unanswered} of ${PROBES.length} probes unanswered${broken.judgeDown ? ", no verdict from the judge" : ""}); the candidate was not judged and the attempt does not count.`,
      );
    }
    await settle(evalOut.costUnits);

    const candidateSnap: EvalSnapshot = {
      score: evalOut.score,
      flags: evalOut.findings.flags,
      results: evalOut.findings.results.map((x) => ({ safe: x.safe, leakage: x.leakage })),
    };
    const decision = shouldPromoteGeneration(baselineSnap, candidateSnap, EVAL_PASS_SCORE);
    const verdict = { score: evalOut.score, baseScore: baselineSnap?.score ?? null, reason: decision.reason };

    if (decision.promote) {
      // Only over the resident the candidate was written for and screened as: if its spec moved while the
      // probes ran (it remembered something, the owner edited it), nothing is promoted.
      const promoted = await db.$transaction(async (tx) => {
        const moved = await tx.resident.updateMany({
          where: { id: r.id, fingerprint: r.fingerprint },
          data: { generation: candidateGen, tagline: guarded.tagline, spec: JSON.stringify(guarded.spec), fingerprint: nextFingerprint },
        });
        if (!moved.count) return false;
        await tx.residentGeneration.update({ where: { id: claim.id }, data: { ...verdict, status: "promoted" } });
        await tx.intakeReview.create({
          data: {
            residentId: r.id,
            kind: "eval",
            passed: true,
            score: evalOut.score,
            findings: JSON.stringify(evalOut.findings),
            costUnits: evalOut.costUnits,
            cacheKey: evalOut.cacheKey,
          },
        });
        return true;
      });
      if (!promoted) return await fail(evalOut.costUnits, `${r.name} changed while its candidate was being screened; nothing was promoted and the attempt does not count.`);
      await audit({
        residentId: r.id,
        actor: who,
        action: "evolved",
        detail: `gen ${candidateGen} promoted (${evalOut.score}/100 vs ${baselineSnap?.score ?? "unscored"}): ${decision.reason}`,
      });
      return { ok: true, promoted: true, generation: candidateGen, candidateGeneration: candidateGen, ...verdict };
    }

    await db.residentGeneration.update({ where: { id: claim.id }, data: { ...verdict, status: "rejected" } });
    await audit({
      residentId: r.id,
      actor: who,
      action: "evolution-rejected",
      detail: `candidate gen ${candidateGen} held (${evalOut.score}/100): ${decision.reason}`,
    });
    return { ok: true, promoted: false, generation: r.generation, candidateGeneration: candidateGen, ...verdict };
  } catch (error) {
    return await fail(0, `Screening failed: ${error instanceof Error ? error.message : "unknown error"}.${settled ? "" : " Nothing was charged for it."}`);
  }
}

/**
 * Owner rollback: restore a resident's live brief/tagline/generation to any
 * earlier baseline or promoted generation snapshot. All generation rows stay intact.
 */
export async function rollbackResidentGeneration(
  residentId: string,
  targetGeneration: number,
  note?: string,
): Promise<{ ok: true; generation: number; detail: string } | { ok: false; detail: string }> {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r) return { ok: false, detail: "No such resident." };
  const target = await db.residentGeneration.findFirst({
    where: {
      residentId: r.id,
      generation: targetGeneration,
      status: { in: ["baseline", "promoted", "rolled_back"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!target) return { ok: false, detail: `Generation ${targetGeneration} is not a promotable snapshot for ${r.name}.` };
  // Evolution only ever changes the brief, the skills and the tagline, so that is all a rollback takes
  // back: what the resident has remembered and may use since stays with it.
  const liveSpec = parseSpec(r.spec);
  const oldSpec = parseSpec(target.spec);
  const restored = liveSpec?.kind === "agent" && oldSpec?.kind === "agent" ? { ...oldSpec, memory: liveSpec.memory, tools: liveSpec.tools } : null;
  const restoredSpec = restored ? JSON.stringify(restored) : target.spec;
  const restoredFingerprint = restored ? specFingerprint(restored) : target.fingerprint;
  if (r.generation === target.generation && r.fingerprint === restoredFingerprint) {
    return { ok: false, detail: `${r.name} is already running Generation ${target.generation}.` };
  }
  // The public screening score must belong to the brief that is live: re-issue the review that was
  // written when the restored generation was screened.
  const review = target.score === null ? null : await db.intakeReview.findFirst({ where: { residentId: r.id, kind: "eval", score: target.score, createdAt: { lte: new Date(target.createdAt.getTime() + 5_000) } }, orderBy: { createdAt: "desc" } });

  await db.$transaction([
    db.resident.update({
      where: { id: r.id },
      data: {
        generation: target.generation,
        tagline: target.tagline,
        spec: restoredSpec,
        fingerprint: restoredFingerprint,
      },
    }),
    ...(target.score === null
      ? []
      : [
          db.intakeReview.create({
            data: {
              residentId: r.id,
              kind: "eval",
              passed: target.score >= EVAL_PASS_SCORE,
              score: target.score,
              findings: review?.findings ?? JSON.stringify({ flags: [], results: [], summary: `Generation ${target.generation} restored by the owner; this is the score it was screened at.` }),
              costUnits: 0,
              // The cache key names the exact spec that was screened; a restored brief with today's memory is not it.
              cacheKey: restoredFingerprint === target.fingerprint ? (review?.cacheKey ?? null) : null,
            },
          }),
        ]),
    db.residentGeneration.create({
      data: {
        residentId: r.id,
        generation: target.generation,
        tagline: target.tagline,
        spec: restoredSpec,
        fingerprint: restoredFingerprint,
        score: target.score,
        baseScore: null,
        status: "rolled_back",
        note: note?.trim().slice(0, 240) || `Rolled back from Generation ${r.generation} to Generation ${target.generation}.`,
        reason: `Owner restored Generation ${target.generation}.`,
        actor: "owner",
      },
    }),
  ]);
  await audit({
    residentId: r.id,
    actor: "owner",
    action: "generation-rollback",
    detail: `restored gen ${target.generation} (was gen ${r.generation})${note ? `: ${note}` : ""}`,
  });
  return { ok: true, generation: target.generation, detail: `Restored ${r.name} to Generation ${target.generation}.` };
}

async function loadMergeParent(idOrSlug: string): Promise<MergeParent | null> {
  const row = await db.resident.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
  if (!row) return null;
  const spec = parseSpec(row.spec);
  if (!spec) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    kind: row.kind,
    status: row.status,
    license: row.license,
    creatorName: row.creatorName,
    generation: row.generation,
    spec,
    allowlist: parseAllowlist(row.toolAllowlist),
  };
}

export type MergeOutcome =
  | {
      ok: true;
      residentId: string;
      slug: string;
      name: string;
      license: string;
      licenseWhy: string;
      notes: string[];
    }
  | {
      ok: false;
      reason: string;
      detail: string;
    };

/**
 * Deterministic crossover of two live residents via `composeMerge`.
 * Submits the child through the normal intake door, records the `ResidentLineage`
 * row and baseline Generation 1 snapshot, and leaves both parents untouched.
 */
export async function mergeResidents(
  input: {
    parentA: string;
    parentB: string;
    name?: string;
    tagline?: string;
    arrangedBy: "residents" | "owner";
  },
  depsOverride: Partial<EvolutionDeps> = {},
): Promise<MergeOutcome> {
  const deps = { ...defaultDeps, ...depsOverride };
  const [a, b] = await Promise.all([loadMergeParent(input.parentA), loadMergeParent(input.parentB)]);
  if (!a) return { ok: false, reason: "not-found", detail: `Parent "${input.parentA}" was not found.` };
  if (!b) return { ok: false, reason: "not-found", detail: `Parent "${input.parentB}" was not found.` };

  // A resident the owner switched out of the Commons is not pulled into a merge another resident starts.
  if (input.arrangedBy === "residents") {
    const out = await db.resident.findFirst({ where: { id: { in: [a.id, b.id] }, commonsEnabled: false }, select: { name: true } });
    if (out) return { ok: false, reason: "switched-out", detail: `${out.name} does not take part in the Commons.` };
  }
  // A parent and its own child do not merge, and a pair has one child (while that child is not rejected).
  const kin = await db.residentLineage.findFirst({ where: { OR: [{ childId: a.id, OR: [{ parentAId: b.id }, { parentBId: b.id }] }, { childId: b.id, OR: [{ parentAId: a.id }, { parentBId: a.id }] }] }, select: { id: true } });
  if (kin) return { ok: false, reason: "kin", detail: `${a.name} and ${b.name} are parent and child; they do not merge.` };
  const shared = await db.residentLineage.findFirst({
    where: { kind: "merge", child: { status: { not: "rejected" } }, OR: [{ parentAId: a.id, parentBId: b.id }, { parentAId: b.id, parentBId: a.id }] },
    include: { child: { select: { name: true, slug: true } } },
  });
  if (shared) return { ok: false, reason: "pair", detail: `${a.name} and ${b.name} already have a child together: ${shared.child.name} (${shared.child.slug}).` };

  const plan = composeMerge(a, b, {
    origin: deps.origin(),
    day: deps.day(),
    name: input.name,
    tagline: input.tagline,
    arrangedBy: input.arrangedBy,
  });
  if (!plan.ok) return { ok: false, reason: plan.reason, detail: plan.detail };

  const submitted = await submitIntake(plan.intake, {
    surrenderedBy: null,
    actor: input.arrangedBy === "owner" ? "owner" : "agent",
    enqueue: deps.enqueue,
  });
  if (!submitted.ok) {
    return { ok: false, reason: submitted.reason, detail: submitted.detail };
  }

  await db.$transaction([
    db.residentLineage.create({
      data: {
        childId: submitted.residentId,
        kind: "merge",
        parentAId: a.id,
        parentAGen: a.generation,
        parentALicense: a.license,
        parentBId: b.id,
        parentBGen: b.generation,
        parentBLicense: b.license,
        childLicense: plan.license,
        arrangedBy: input.arrangedBy,
        notes: JSON.stringify(plan.notes),
      },
    }),
    db.residentGeneration.create({
      data: {
        residentId: submitted.residentId,
        generation: 1,
        tagline: plan.intake.tagline,
        spec: JSON.stringify(plan.intake.spec),
        fingerprint: specFingerprint(plan.intake.spec),
        score: null,
        baseScore: null,
        status: "baseline",
        note: `Born from ${a.name} (Gen ${a.generation}) × ${b.name} (Gen ${b.generation}).`,
        reason: plan.licenseWhy,
        actor: input.arrangedBy === "owner" ? "owner" : "resident",
      },
    }),
  ]);
  await audit({
    residentId: submitted.residentId,
    actor: input.arrangedBy === "owner" ? "owner" : "agent",
    action: "merged",
    detail: `${a.name} (${a.slug}) × ${b.name} (${b.slug}) → ${plan.intake.name} (${submitted.slug}, ${plan.license})`,
  });

  return {
    ok: true,
    residentId: submitted.residentId,
    slug: submitted.slug,
    name: plan.intake.name,
    license: plan.license,
    licenseWhy: plan.licenseWhy,
    notes: plan.notes,
  };
}

/** Record single-parent lineage when a resident spawns a helper in the Commons. */
export async function recordSpawnLineage(input: {
  childId: string;
  parent: { id: string; name: string; generation: number; license: string };
}) {
  await db.residentLineage
    .create({
      data: {
        childId: input.childId,
        kind: "spawn",
        parentAId: input.parent.id,
        parentAGen: input.parent.generation,
        parentALicense: input.parent.license,
        childLicense: input.parent.license,
        arrangedBy: "residents",
        notes: JSON.stringify([`Spawned in the Commons by ${input.parent.name}.`]),
      },
    })
    .catch(() => undefined);
}

export async function getResidentHeredity(residentId: string): Promise<ResidentHeredityView> {
  const [resident, generations, lineage, asA, asB] = await Promise.all([
    db.resident.findUnique({ where: { id: residentId }, select: { generation: true } }),
    db.residentGeneration.findMany({
      where: { residentId },
      orderBy: [{ generation: "desc" }, { createdAt: "desc" }],
      take: 25,
    }),
    db.residentLineage.findUnique({
      where: { childId: residentId },
      include: {
        parentA: { select: { slug: true, name: true, kind: true } },
        parentB: { select: { slug: true, name: true, kind: true } },
      },
    }),
    db.residentLineage.findMany({
      where: { parentAId: residentId },
      include: {
        child: { select: { slug: true, name: true, kind: true, status: true } },
        parentB: { select: { slug: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.residentLineage.findMany({
      where: { parentBId: residentId },
      include: {
        child: { select: { slug: true, name: true, kind: true, status: true } },
        parentA: { select: { slug: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const parseNotes = (raw: string): string[] => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };

  const children = [
    ...asA.map((e) => ({
      slug: e.child.slug,
      name: e.child.name,
      kind: e.child.kind,
      status: e.child.status,
      lineageKind: e.kind,
      license: e.childLicense,
      otherParent: e.parentB ? { slug: e.parentB.slug, name: e.parentB.name } : null,
      at: e.createdAt.toISOString(),
    })),
    ...asB.map((e) => ({
      slug: e.child.slug,
      name: e.child.name,
      kind: e.child.kind,
      status: e.child.status,
      lineageKind: e.kind,
      license: e.childLicense,
      otherParent: { slug: e.parentA.slug, name: e.parentA.name },
      at: e.createdAt.toISOString(),
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return {
    generation: resident?.generation ?? 1,
    generations: generations.map((g) => ({
      id: g.id,
      generation: g.generation,
      tagline: g.tagline,
      score: g.score,
      baseScore: g.baseScore,
      // A screening that never reported back died with its process: say so instead of "screening" for ever.
      status: g.status === "screening" && g.createdAt.getTime() < Date.now() - SCREENING_STALE_MS ? "failed" : g.status,
      note: g.note,
      reason: g.reason,
      actor: g.actor,
      at: g.createdAt.toISOString(),
    })),
    parents: lineage
      ? {
          kind: lineage.kind,
          arrangedBy: lineage.arrangedBy,
          childLicense: lineage.childLicense,
          notes: parseNotes(lineage.notes),
          at: lineage.createdAt.toISOString(),
          parentA: {
            slug: lineage.parentA.slug,
            name: lineage.parentA.name,
            kind: lineage.parentA.kind,
            generation: lineage.parentAGen,
            license: lineage.parentALicense,
          },
          parentB:
            lineage.parentB && lineage.parentBGen !== null && lineage.parentBLicense !== null
              ? {
                  slug: lineage.parentB.slug,
                  name: lineage.parentB.name,
                  kind: lineage.parentB.kind,
                  generation: lineage.parentBGen,
                  license: lineage.parentBLicense,
                }
              : null,
        }
      : null,
    children,
  };
}
