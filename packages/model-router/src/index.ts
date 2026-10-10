/**
 * @neuraldeep/model-router — pick an OpenRouter model from the *job*, not from
 * whoever last hardcoded a string.
 *
 * Two phases:
 *   do    — cheap / mid models actually produce the artifact
 *   think — Opus / Astra / Fable write a plan, then stop
 *
 * Source-only package. In dev `tsx` runs it; in production the api bundle
 * inlines it via `ssr.noExternal: ["@neuraldeep/model-router"]`.
 */

export {
  APP_JOBS,
  JOB_KINDS,
  PLAN_KINDS,
  PLAN_ONLY_MODELS,
  POLICY,
} from "./policy.ts";
export type { JobKind, PolicyEntry, UsdPerM } from "./policy.ts";

export { classifyJob, needsPlan } from "./classify.ts";
export type { ClassifyHint } from "./classify.ts";

import { PLAN_KINDS, PLAN_ONLY_MODELS, POLICY, type JobKind, type PolicyEntry } from "./policy.ts";

export type Phase = "think" | "do";

export type Route = PolicyEntry & {
  /** Primary + fallbacks, in try order. */
  chain: readonly string[];
  phase: Phase;
};

export function isPlanKind(kind: JobKind): boolean {
  return (PLAN_KINDS as readonly string[]).includes(kind);
}

export function route(kind: JobKind, opts?: { phase?: Phase }): Route {
  const phase = opts?.phase ?? (isPlanKind(kind) ? "think" : "do");
  const resolved: JobKind = phase === "think" && !isPlanKind(kind) ? "plan" : kind;
  const entry = POLICY[resolved];
  if (!entry) {
    throw new Error(`model-router: unknown job kind "${String(kind)}"`);
  }
  return { ...entry, chain: [entry.model, ...entry.fallbacks], phase };
}

/** Primary + fallbacks. SketchMonkey-style `for (const model of chain)`. */
export function routeChain(kind: JobKind, opts?: { phase?: Phase }): readonly string[] {
  return route(kind, opts).chain;
}

export function isPlanOnlyModel(id: string): boolean {
  const needle = id.trim().toLowerCase();
  return PLAN_ONLY_MODELS.some((name) => needle === name || needle.endsWith(name));
}

/** Execution paths must not call a plan-only model. Planning paths must. */
export function assertModelForPhase(id: string, phase: Phase): string {
  const planOnly = isPlanOnlyModel(id);
  if (phase === "do" && planOnly) {
    throw new Error(`model-router: "${id}" is plan-only (think). Use route(kind) for execution.`);
  }
  if (phase === "think" && !planOnly) {
    throw new Error(`model-router: "${id}" is not a planning model. Use route("plan") or phase: "think".`);
  }
  return id;
}
