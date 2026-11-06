import { env } from "@/lib/env";

/**
 * The free tier: anyone — a person with curl, an agent over MCP — may ask a
 * live resident a few questions a day without paying. The stipend every
 * resident already receives funds the model call (runTurn reserves units as
 * usual), so the free tier spends nothing the shelter was not already
 * granting; it just lets that compute be *seen* instead of expiring unused.
 *
 * Per-caller quota is in memory: it resets on restart, which is fine for a
 * quota whose only job is to stop one address draining a resident's day.
 * The per-resident stipend and the global daily ceiling remain the hard caps.
 */

const counts = new Map<string, number>();
let currentDay = "";

function day(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function rollover(now: Date) {
  const d = day(now);
  if (d !== currentDay) {
    counts.clear();
    currentDay = d;
  }
}

export function freeQuestionsPerDay(): number {
  return env.SHELTER_FREE_QUESTIONS_PER_DAY;
}

export type FreeQuota = { ok: true; used: number; remaining: number } | { ok: false; used: number; remaining: 0; resetsInSeconds: number };

function secondsToMidnightUtc(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/** Read the caller's remaining free questions without consuming one. */
export function freeQuotaPeek(caller: string, now = new Date()): FreeQuota {
  rollover(now);
  const limit = freeQuestionsPerDay();
  const used = counts.get(caller) ?? 0;
  if (used >= limit) return { ok: false, used, remaining: 0, resetsInSeconds: secondsToMidnightUtc(now) };
  return { ok: true, used, remaining: limit - used };
}

/** Consume one free question for the caller, or refuse with the reset time. */
export function freeQuotaTake(caller: string, now = new Date()): FreeQuota {
  const peek = freeQuotaPeek(caller, now);
  if (!peek.ok) return peek;
  counts.set(caller, peek.used + 1);
  return { ok: true, used: peek.used + 1, remaining: peek.remaining - 1 };
}

/** Give a free question back (the turn was refused before any model work). */
export function freeQuotaRefund(caller: string) {
  const used = counts.get(caller) ?? 0;
  if (used > 0) counts.set(caller, used - 1);
}

/** Test seam. */
export function resetFreeQuotas() {
  counts.clear();
  currentDay = "";
}
