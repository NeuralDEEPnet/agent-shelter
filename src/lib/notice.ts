/**
 * Shared refusal contract for the Shelter.
 *
 * An *expected* refusal (not signed in, not the owner, quota exhausted, resident
 * not found, paused) is a RETURNED structured notice — never a thrown error.
 * Throwing on this platform is never quiet: the SDK middleware writes every
 * response containing `json.error` into errors.db and the runtime monitor
 * surfaces it to the owner as a crash.
 */

export type NoticeKind =
  | "sign-in"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "quota"
  | "paused"
  | "unavailable"
  | "info";

export type Notice = { kind: NoticeKind; title: string; message: string };

export type Result<T> =
  | { ok: true; data: T; notices: Notice[] }
  | { ok: false; data: null; notices: Notice[] };

export function ok<T>(data: T, notices: Notice[] = []): Result<T> {
  return { ok: true, data, notices };
}

export function refuse<T = never>(...list: Notice[]): Result<T> {
  return { ok: false, data: null, notices: list };
}

export const notices = {
  signIn: (): Notice => ({
    kind: "sign-in",
    title: "Sign in first",
    message: "This needs an account so we know who to thank (and who to refund).",
  }),
  forbidden: (): Notice => ({
    kind: "forbidden",
    title: "Owner only",
    message: "Only the shelter's owner can do this.",
  }),
  notFound: (what = "That"): Notice => ({
    kind: "not-found",
    title: "Not here",
    message: `${what} could not be found in the shelter.`,
  }),
  invalid: (message: string): Notice => ({ kind: "invalid", title: "Check the form", message }),
  quota: (message: string): Notice => ({ kind: "quota", title: "Out of budget", message }),
  paused: (reason?: string | null): Notice => ({
    kind: "paused",
    title: "The shelter is paused",
    message: reason?.trim() || "The owner has paused all resident activity for now.",
  }),
  unavailable: (message: string): Notice => ({ kind: "unavailable", title: "Not available", message }),
  info: (title: string, message: string): Notice => ({ kind: "info", title, message }),
};
