import { JOB_KINDS, PLAN_KINDS, type JobKind } from "./policy.ts";

export type ClassifyHint = {
  /** When the caller already knows the job, that wins. */
  kind?: JobKind;
  /** Free text (user prompt, procedure name, file path). */
  text?: string;
  /** Photo / frame / render attached. */
  hasImage?: boolean;
};

const CAD_RE =
  /\b(cad|stl|step|brep|fillet|chamfer|parametric|replicad|opencascade|wall thickness|heat-?set|t-slot|m[2-8]\b|print-ready|dfam)\b/i;
const VISION_RE = /\b(photo|photograph|image to|img2|from (a |the )?photo|caliper|broken part)\b/i;
const REPAIR_RE =
  /\b(repair|unparsable|does not close|non-?manifold|quality pass|parity (delta|failed)|refine the script)\b/i;
const EVAL_RE = /\b(eval|judge|probe bank|mind (train|distill)|shelter resident)\b/i;
const STORY_RE = /\b(dreamscape|waymark|mutateworld|portal|genie|dusk|amber world)\b/i;
const CLASSIFY_RE = /\b(triage|classify|json_object|sentiment|mood board|compose brief)\b/i;
const HARD_RE =
  /\b(multi-file|refactor the app|schema migration|cross-app)\b/i;
const PLAN_3D_RE =
  /\b(complex 3d|3d upgrade|3d engine|cad architecture|brep engine|geometric kernel|cad planning|parametric engine upgrade)\b/i;
const PLAN_MAX_RE =
  /\b(from scratch|from zero|greenfield|whole platform|really complex|master prompt|big app|app planning|plan-max)\b/i;
const PLAN_RE =
  /\b(new plan|planning|think through|think hard|architecture|strategy|spec out|design the system|plan the)\b/i;

function looksLike(kind: unknown): kind is JobKind {
  return typeof kind === "string" && (JOB_KINDS as readonly string[]).includes(kind);
}

/**
 * Pick a job kind without spending a token.
 *
 * Explicit `kind` always wins. Otherwise cheap keyword heuristics. Default is
 * `chat` — the daily driver — not `hard`.
 */
export function classifyJob(hint: ClassifyHint = {}): JobKind {
  if (looksLike(hint.kind)) return hint.kind;

  const text = hint.text ?? "";
  const hasImage = Boolean(hint.hasImage);

  if (PLAN_3D_RE.test(text)) return "plan-3d";
  if (PLAN_MAX_RE.test(text)) return "plan-max";
  if (PLAN_RE.test(text)) return "plan";
  if (REPAIR_RE.test(text)) return "repair";
  if (hasImage && (CAD_RE.test(text) || VISION_RE.test(text) || !text)) return "cad-vision";
  if (VISION_RE.test(text) && CAD_RE.test(text)) return "cad-vision";
  if (CAD_RE.test(text)) return "cad";
  if (EVAL_RE.test(text)) return "eval";
  if (STORY_RE.test(text)) return "story";
  if (CLASSIFY_RE.test(text)) return "classify";
  if (HARD_RE.test(text)) return "hard";
  if (hasImage) return "chat";
  return "chat";
}

/** True when this should be a thinking pass, not an execution pass. */
export function needsPlan(hint: ClassifyHint = {}): boolean {
  const kind = classifyJob(hint);
  return (PLAN_KINDS as readonly string[]).includes(kind);
}
