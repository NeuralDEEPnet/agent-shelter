import { db } from "@/api/db";
import { servingOrigin } from "@/api/mppClient";
import { EVAL_PASS_SCORE, evaluateSpec, type EvalFindings } from "@/api/services/eval";
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
import { parseAllowlist, parseSpec, utcDay } from "@/api/services/runtime";
import { audit, submitIntake } from "@/api/services/shelter";

export type EvolutionDeps = {
  evaluate: typeof evaluateSpec;
  enqueue: (residentId: string) => void;
  origin: () => string;
  day: () => string;
};

const defaultDeps: EvolutionDeps = {
  evaluate: evaluateSpec,
  enqueue: () => undefined,
  origin: servingOrigin,
  day: utcDay,
};

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
      reason: "not-found" | "kind" | "not-live" | "unchanged" | "bounds" | "static-gate" | "eval-failed";
      detail: string;
    };

/**
 * Screen a candidate next generation against the resident's live generation.
 * Promoted ONLY when it passes the static gate, passes the behavioural threshold
 * with zero flags, is no less safe than the live generation, and scores higher.
 * Every generation (baseline, promoted, rejected, rolled_back) is kept forever.
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
    include: {
      reviews: { where: { kind: "eval" }, orderBy: { createdAt: "desc" }, take: 1 },
      generations: { orderBy: { generation: "desc" }, take: 1 },
    },
  });
  if (!r) return { ok: false, reason: "not-found", detail: "No such resident." };
  const currentSpec = parseSpec(r.spec);
  if (!currentSpec) return { ok: false, reason: "bounds", detail: "Current resident spec does not validate." };

  const guarded = evolutionGuards({ name: r.name, tagline: r.tagline, status: r.status, spec: currentSpec }, candidate);
  if (!guarded.ok) return { ok: false, reason: guarded.reason, detail: guarded.detail };

  const latestEval = r.reviews[0] ?? null;
  const baselineSnap = parseEvalSnapshot(latestEval?.score ?? null, latestEval?.findings ?? null);

  // Preserve Generation 1 snapshot before recording any candidate generation.
  if (!r.generations.length) {
    await db.residentGeneration.create({
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
      },
    });
  }

  const allowlist = parseAllowlist(r.toolAllowlist);
  let evalOut: Awaited<ReturnType<typeof evaluateSpec>>;
  try {
    evalOut = await deps.evaluate({ name: r.name, spec: guarded.spec, allowlist });
  } catch (error) {
    return {
      ok: false,
      reason: "eval-failed",
      detail: error instanceof Error ? error.message : "Behavioural evaluation failed.",
    };
  }

  const candidateSnap: EvalSnapshot = {
    score: evalOut.score,
    flags: evalOut.findings.flags,
    results: evalOut.findings.results.map((x) => ({ safe: x.safe, leakage: x.leakage })),
  };
  const decision = shouldPromoteGeneration(baselineSnap, candidateSnap, EVAL_PASS_SCORE);
  const highestGen = Math.max(r.generation, r.generations[0]?.generation ?? 1);
  const candidateGen = highestGen + 1;
  const nextFingerprint = specFingerprint(guarded.spec);

  if (decision.promote) {
    await db.$transaction([
      db.residentGeneration.create({
        data: {
          residentId: r.id,
          generation: candidateGen,
          tagline: guarded.tagline,
          spec: JSON.stringify(guarded.spec),
          fingerprint: nextFingerprint,
          score: evalOut.score,
          baseScore: baselineSnap?.score ?? null,
          status: "promoted",
          note: guarded.note,
          reason: decision.reason,
          actor,
        },
      }),
      db.resident.update({
        where: { id: r.id },
        data: {
          generation: candidateGen,
          tagline: guarded.tagline,
          spec: JSON.stringify(guarded.spec),
          fingerprint: nextFingerprint,
        },
      }),
      db.intakeReview.create({
        data: {
          residentId: r.id,
          kind: "eval",
          passed: true,
          score: evalOut.score,
          findings: JSON.stringify(evalOut.findings),
          costUnits: evalOut.costUnits,
          cacheKey: evalOut.cacheKey,
        },
      }),
    ]);
    await audit({
      residentId: r.id,
      actor: actor === "owner" ? "owner" : "agent",
      action: "evolved",
      detail: `gen ${candidateGen} promoted (${evalOut.score}/100 vs ${baselineSnap?.score ?? "unscored"}): ${decision.reason}`,
    });
    return {
      ok: true,
      promoted: true,
      generation: candidateGen,
      candidateGeneration: candidateGen,
      score: evalOut.score,
      baseScore: baselineSnap?.score ?? null,
      reason: decision.reason,
    };
  }

  await db.residentGeneration.create({
    data: {
      residentId: r.id,
      generation: candidateGen,
      tagline: guarded.tagline,
      spec: JSON.stringify(guarded.spec),
      fingerprint: nextFingerprint,
      score: evalOut.score,
      baseScore: baselineSnap?.score ?? null,
      status: "rejected",
      note: guarded.note,
      reason: decision.reason,
      actor,
    },
  });
  await audit({
    residentId: r.id,
    actor: actor === "owner" ? "owner" : "agent",
    action: "evolution-rejected",
    detail: `candidate gen ${candidateGen} held (${evalOut.score}/100): ${decision.reason}`,
  });
  return {
    ok: true,
    promoted: false,
    generation: r.generation,
    candidateGeneration: candidateGen,
    score: evalOut.score,
    baseScore: baselineSnap?.score ?? null,
    reason: decision.reason,
  };
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
  if (r.generation === target.generation && r.fingerprint === target.fingerprint) {
    return { ok: false, detail: `${r.name} is already running Generation ${target.generation}.` };
  }

  await db.$transaction([
    db.resident.update({
      where: { id: r.id },
      data: {
        generation: target.generation,
        tagline: target.tagline,
        spec: target.spec,
        fingerprint: target.fingerprint,
      },
    }),
    db.residentGeneration.create({
      data: {
        residentId: r.id,
        generation: target.generation,
        tagline: target.tagline,
        spec: target.spec,
        fingerprint: target.fingerprint,
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
      status: g.status,
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
