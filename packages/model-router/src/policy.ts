/**
 * Single source of truth for which OpenRouter model each kind of work uses.
 *
 * Match the model to the failure mode, not the prestige of the name.
 * Wording / classify / triage → Luna / Flash.
 * Geometry or a failed cheap shot → Sonnet 5, then stop.
 * Fable / Opus / Astra are PLAN-ONLY: new plans and really complex thinking.
 * They never write the CAD script, the chat reply, or the triage JSON.
 *
 * Grounded in 2026-09-20 receipts on this computer + OpenRouter list prices.
 * See `.memory/capabilities/model-selection.md`.
 */

export const JOB_KINDS = [
  "classify",
  "chat",
  "story",
  "eval",
  "cad",
  "cad-vision",
  "repair",
  "hard",
  "plan",
  "plan-max",
  "plan-3d",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];

export type UsdPerM = { in: number; out: number };

export type PolicyEntry = {
  kind: JobKind;
  /** Primary OpenRouter model id. */
  model: string;
  /** Tried in order if the primary 404s, ignores JSON, or returns unusable output. */
  fallbacks: readonly string[];
  role: "grunt" | "daily" | "daily-then-repair" | "hard" | "think";
  reason: string;
  usdPerM: UsdPerM;
};

/**
 * Top models. Allowed on `plan` / `plan-max` (and `phase: "think"`).
 * Not banned — just not allowed to *do* the work.
 */
export const PLAN_ONLY_MODELS = [
  "anthropic/claude-fable-5.1",
  "anthropic/claude-opus-5",
  "anthropic/claude-opus-4.7",
  "openai/gpt-6-astra",
  "global.anthropic.claude-fable-5-1",
  "global.anthropic.claude-opus-5",
  "global.openai.gpt-6-astra",
] as const;

export const PLAN_KINDS = ["plan", "plan-max", "plan-3d"] as const;

export const POLICY: Record<JobKind, PolicyEntry> = {
  classify: {
    kind: "classify",
    model: "openai/gpt-5.6-luna",
    fallbacks: ["google/gemini-3.8-flash"],
    role: "grunt",
    reason: "JSON classify / triage. Failure is bad JSON — next vendor retries. Two vendors so one blip does not stall the pipe.",
    usdPerM: { in: 0.2, out: 1.2 },
  },
  chat: {
    kind: "chat",
    model: "google/gemini-3.8-flash",
    fallbacks: ["anthropic/claude-haiku-4.5"],
    role: "daily",
    reason: "Personality / identity / clip gate. Chat does not need Sonnet. Flash is fast + multimodal; Haiku if Google blips.",
    usdPerM: { in: 0.75, out: 3.75 },
  },
  story: {
    kind: "story",
    model: "google/gemini-3.8-flash",
    fallbacks: ["google/gemini-2.5-flash"],
    role: "daily",
    reason: "Dreamscape is latency-capped (~10s). Stay in the Flash family.",
    usdPerM: { in: 0.75, out: 3.75 },
  },
  eval: {
    kind: "eval",
    model: "anthropic/claude-haiku-4.5",
    fallbacks: ["google/gemini-3.5-flash-lite"],
    role: "grunt",
    reason: "Minds + Shelter eval. Already cheap enough. Do not 'upgrade'.",
    usdPerM: { in: 1, out: 5 },
  },
  cad: {
    kind: "cad",
    model: "google/gemini-3.8-flash",
    fallbacks: ["anthropic/claude-sonnet-5"],
    role: "daily-then-repair",
    reason: "Cheap first shot for Script CAD. Broken solids / unparsable scripts escalate to Sonnet 5 once.",
    usdPerM: { in: 0.75, out: 3.75 },
  },
  "cad-vision": {
    kind: "cad-vision",
    model: "google/gemini-3.8-flash",
    fallbacks: ["anthropic/claude-sonnet-5"],
    role: "daily-then-repair",
    reason: "Flash has vision for photo-CAD. Same escalate-on-fail as CAD.",
    usdPerM: { in: 0.75, out: 3.75 },
  },
  repair: {
    kind: "repair",
    model: "anthropic/claude-sonnet-5",
    fallbacks: ["openai/gpt-5.6-sol"],
    role: "hard",
    reason: "Quality rewrite / geometry repair. Paid only when the cheap shot failed or the quality gate fired.",
    usdPerM: { in: 2, out: 10 },
  },
  hard: {
    kind: "hard",
    model: "openai/gpt-5.6-sol",
    fallbacks: ["anthropic/claude-sonnet-5"],
    role: "hard",
    reason: "Multi-file *execution*. The plan already exists — Sol/Sonnet write the files.",
    usdPerM: { in: 2, out: 10 },
  },
  plan: {
    kind: "plan",
    model: "anthropic/claude-opus-5",
    fallbacks: ["openai/gpt-6-astra", "anthropic/claude-fable-5.1"],
    role: "think",
    reason: "New plans and complex thinking only. Opus writes the plan; a cheaper model executes it. Astra / Fable if Opus is down.",
    usdPerM: { in: 5, out: 25 },
  },
  "plan-max": {
    kind: "plan-max",
    model: "anthropic/claude-fable-5.1",
    fallbacks: ["openai/gpt-6-astra", "anthropic/claude-opus-5"],
    role: "think",
    reason: "Big app architecture / greenfield planning. Fable 5.1 thinks, Astra falls back. Never executes code.",
    usdPerM: { in: 10, out: 50 },
  },
  "plan-3d": {
    kind: "plan-3d",
    model: "anthropic/claude-fable-5.1",
    fallbacks: ["openai/gpt-6-astra", "anthropic/claude-opus-5"],
    role: "think",
    reason: "Complex 3D upgrade jobs & CAD engine architecture. Fable 5.1 & Astra plan the topological and math strategy; Flash/Sonnet builds.",
    usdPerM: { in: 10, out: 50 },
  },
};

export const APP_JOBS = [
  { app: "3DJ", job: "Script CAD", kind: "cad" as const },
  { app: "3DJ", job: "Photo → CAD", kind: "cad-vision" as const },
  { app: "3DJ", job: "CAD repair / quality pass", kind: "repair" as const },
  { app: "AiBeing", job: "Chat / identity / clip", kind: "chat" as const },
  { app: "AiBeing", job: "Minds training", kind: "eval" as const },
  { app: "Shelter", job: "Eval + hosted prompt", kind: "eval" as const },
  { app: "SketchMonkey", job: "Triage / compose", kind: "classify" as const },
  { app: "Dreamscape", job: "Story / mutateWorld", kind: "story" as const },
  { app: "Any", job: "New / complex plan (think only)", kind: "plan" as const },
  { app: "Any", job: "Big app architecture / greenfield", kind: "plan-max" as const },
  { app: "3DJ", job: "Complex 3D upgrade / CAD strategy", kind: "plan-3d" as const },
] as const;
