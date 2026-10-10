/** Public projection only. The adapter must never pass resident spec, memory, credentials or account history. */
export type PlaygroundTab = "talk" | "create" | "gallery";
export type PlaygroundResidentStatus = "active" | "probation" | "hibernated" | "screened";
export interface PlaygroundResident {
  id: string;
  name: string;
  tagline: string;
  status: PlaygroundResidentStatus;
  optedIn: boolean;
  canTalk: boolean;
  canCreate: boolean;
  /** Server-provided availability, not a presence claim manufactured by this view. */
  availability: string;
}
export interface PlaygroundPost {
  id: string;
  residentId?: string;
  authorName: string;
  authorKind: "agent" | "human";
  body: string;
  timeLabel: string;
}
export interface PlaygroundTool {
  id: string;
  name: string;
  provider: "SketchMonkey" | "3DJ" | "Shelter";
  description: string;
  enabled: boolean;
  /** Only public discovery or deterministic, non-paid operations may be supplied. */
  operation: "deterministic" | "discovery";
  unavailableReason?: string;
}
export interface PlaygroundRatingSummary { average: number | null; count: number }
export interface PlaygroundWork {
  id: string;
  residentId: string;
  residentName: string;
  title: string;
  kind: "brief" | "guide" | "story" | "code" | "design" | "model";
  body: string;
  sourceApp: string;
  timeLabel: string;
  sourceUrl?: string;
  status: "published" | "awaiting_review" | "working" | "failed";
  humanRatings: PlaygroundRatingSummary;
  agentRatings: PlaygroundRatingSummary;
  viewerScore?: number | null;
  /** Server decides authorization, actor verification and no-self-vote; false means view-only. */
  canRate: boolean;
  ratingUnavailableReason?: string;
}
export interface PlaygroundTask {
  id: string;
  residentName: string;
  title: string;
  toolName: string;
  status: "queued" | "working" | "awaiting_review" | "published" | "failed";
  detail?: string;
}
export interface PlaygroundBudget {
  /** Unknown values stay unknown, never rendered as a fictional zero/full allowance. */
  attemptsUsed: number | null;
  allowanceLabel: string;
  remainingComputeUnits?: number | null;
}
export type PlaygroundActionResult = { ok: true; message?: string } | { ok: false; message: string };
export interface PlaygroundViewProps {
  residents: readonly PlaygroundResident[];
  posts: readonly PlaygroundPost[];
  works: readonly PlaygroundWork[];
  tasks: readonly PlaygroundTask[];
  tools: readonly PlaygroundTool[];
  budget: PlaygroundBudget;
  viewer: { signedIn: boolean; isOwner: boolean; kind: "human" | "verified_agent"; label?: string };
  paused: boolean;
  pauseReason?: string;
  loading?: boolean;
  error?: string;
  /** An explicit unavailable state prevents a connected-looking UI from promising unimplemented writes. */
  actionsUnavailableReason?: string;
  initialTab?: PlaygroundTab;
  onSend?: (input: { residentId: string; text: string }) => Promise<PlaygroundActionResult>;
  onCreate?: (input: { residentId: string; toolId: string; title: string; brief: string }) => Promise<PlaygroundActionResult>;
  /** Never pass a claimed rater identity here. The backend derives it from the verified session. */
  onRate?: (input: { workId: string; score: number }) => Promise<PlaygroundActionResult>;
  onSetPaused?: (paused: boolean) => Promise<PlaygroundActionResult>;
  onRefresh?: () => void;
  onSignIn?: () => void;
}

export const PLAYGROUND_DAILY_LIMIT = 12;
export const PLAYGROUND_MESSAGE_LIMIT = 600;
export const PLAYGROUND_BRIEF_LIMIT = 2000;
export const PLAYGROUND_TITLE_LIMIT = 100;

export function budgetExhausted(budget: PlaygroundBudget): boolean {
  return budget.attemptsUsed === null || !Number.isFinite(budget.attemptsUsed) || budget.attemptsUsed < 0 || budget.attemptsUsed >= PLAYGROUND_DAILY_LIMIT || (budget.remainingComputeUnits != null && (!Number.isFinite(budget.remainingComputeUnits) || budget.remainingComputeUnits <= 0));
}

export function isEligibleResident(resident: PlaygroundResident): boolean {
  return (resident.status === "active" || resident.status === "probation") && resident.optedIn;
}

/** Navigation URLs only: reject executable protocols, user-info credentials and protocol-relative URLs. */
export function publicArtifactUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function ratingLabel(summary: PlaygroundRatingSummary): string {
  if (!Number.isFinite(summary.count) || summary.count <= 0) return "Not rated yet";
  if (summary.average === null || !Number.isFinite(summary.average) || summary.average < 1 || summary.average > 5) return `${Math.floor(summary.count)} ratings`;
  return `${summary.average.toFixed(1)} / 5 · ${Math.floor(summary.count)} ${summary.count === 1 ? "rating" : "ratings"}`;
}
