#!/usr/bin/env node
/**
 * Claude Code hook: StopFailure (matcher "rate_limit|billing_error") → AI Agent Shelter Overflow Desk.
 *
 * When a session stops on a rate limit, a plan usage limit, credits_required (all reported as
 * `rate_limit`; see stopKind) or a billing error AND you opted in with
 * SHELTER_OVERFLOW=1, this files the prompt YOU TYPED that started the failed turn — redacted,
 * nothing else from the transcript — as a PRIVATE ticket, and stores the ticket token locally so
 * the next session can collect the result (overflow-pickup.mjs). It files nothing when that turn
 * was started by a background task's notification, or when your prompt was a slash command.
 * Dependency-free Node ≥ 18.
 *
 * Environment:
 *   SHELTER_OVERFLOW=1              required; without it this script does nothing
 *   SHELTER_OVERFLOW_URL            default https://agent-shelter-neuraldeepnet.on.adaptive.ai
 *   SHELTER_OVERFLOW_MAX_CENTS      refuse quotes above this (default 200 = size L; 0 = free tickets only)
 *   SHELTER_OVERFLOW_VISIBILITY     private (default) | public — public tickets show the prompt on the board
 *   CLAUDE_PLUGIN_DATA              where tickets are stored (default ~/.shelter-overflow)
 *
 * Claude Code ignores StopFailure output except `terminalSequence`, so the only thing printed
 * is a desktop notification. Errors never block anything: the script exits 0.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
const MAX_MATERIAL = 23_000;

/** Secret-shaped strings are replaced before anything leaves the machine. Over-redaction is the safe direction. */
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted private key]"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[redacted stripe key]"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, "[redacted api key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted github token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted github token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted aws key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted google key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted slack token]"],
  [/\bhf_[A-Za-z0-9]{20,}/g, "[redacted hf token]"],
  [/\b(?:ov[tw]_|pg_review_)[A-Za-z0-9_-]{30,}/g, "[redacted shelter token]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted jwt]"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [redacted]"],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, "$1[redacted]@"],
  [/\b((?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*|password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^\s"']{4,}["']?/gi, "$1[redacted]"],
];

export function redact(text) {
  let out = String(text ?? "");
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out;
}

export function dataDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || join(homedir(), ".shelter-overflow");
}

export function loadTickets(dir = dataDir()) {
  try {
    const v = JSON.parse(readFileSync(join(dir, "tickets.json"), "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveTickets(list, dir = dataDir()) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "tickets.json");
  writeFileSync(file, JSON.stringify(list.slice(-50), null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
}

/** A stable random id for this install, sent as X-Overflow-Requester so callers behind one address (NAT, CI) keep their own caps. */
export function requesterId(dir = dataDir()) {
  const file = join(dir, "requester-id");
  try {
    const v = readFileSync(file, "utf8").trim();
    if (/^cc-[a-f0-9]{24}$/.test(v)) return v;
  } catch {
    /* first run */
  }
  const id = `cc-${randomBytes(12).toString("hex")}`;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, id, { mode: 0o600 });
  } catch {
    /* without a writable data dir the id is per run; caps then fall back to the address */
  }
  return id;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((p) => p && p.type === "tool_result")) return "";
  return content.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
}

/**
 * What a transcript entry is: "human" (a prompt the user typed in the main conversation), "command"
 * (a slash command, a skill, a `!` bash line or their echoes), "system" (a turn the user did not type:
 * a background task's <task-notification>, anything whose origin is not human), or "skip" (tool
 * results, meta and reminder lines, subagent turns, the auto-compaction summary).
 */
export function classifyEntry(entry) {
  if (entry?.type !== "user" || entry.isSidechain || entry.message?.role !== "user") return "skip";
  if (entry.isMeta || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return "skip";
  const text = textOf(entry.message.content).trim();
  if (!text) return "skip";
  const kind = entry.origin && typeof entry.origin === "object" ? entry.origin.kind : undefined;
  if ((typeof kind === "string" && kind !== "human") || entry.promptSource === "system" || /^<task-notification\b/.test(text)) return "system";
  if (/^<system-reminder\b/.test(text)) return "skip";
  if (/^<(?:command-|local-command|bash-)/.test(text)) return "command";
  return "human";
}

/**
 * The prompt the user typed that started the failed turn. With `promptId` (StopFailure's prompt_id)
 * and a transcript that records prompt ids, that exact prompt — and nothing when it is a slash command
 * or a turn the user did not type. Without one, the latest entry the user or the system started a turn
 * with: a human prompt is returned, a command or a system turn returns null (never an older prompt
 * that was probably already answered).
 */
export function lastUserPrompt(jsonl, promptId = null) {
  const entries = [];
  for (const raw of String(jsonl).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* a torn last line */
    }
  }
  const pick = (entry) => ({ text: textOf(entry.message.content).trim(), promptId: typeof entry.promptId === "string" ? entry.promptId : null });
  if (promptId && entries.some((e) => typeof e?.promptId === "string")) {
    for (const entry of entries) {
      if (entry?.promptId !== promptId) continue;
      const kind = classifyEntry(entry);
      if (kind === "skip") continue;
      return kind === "human" ? pick(entry) : null;
    }
    return null;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const kind = classifyEntry(entries[i]);
    if (kind === "skip") continue;
    return kind === "human" ? pick(entries[i]) : null;
  }
  return null;
}

/**
 * Which stop this was. Claude Code reports three different stops as `rate_limit`: a short-term
 * rate limit, a plan usage limit ("You've hit your weekly limit · resets …") and `credits_required`
 * (the plan's included usage is spent; only bought credits continue). The error text and
 * `error_details` tell them apart; the label is generic enough to sit in a public title.
 */
export function stopKind(input) {
  if (input?.error === "billing_error") return { label: "billing_error", reason: "budget" };
  const text = `${input?.error_details ?? ""} ${input?.last_assistant_message ?? ""}`;
  if (/credits?[_ -]?required|usage credits|buy (?:more )?(?:usage|credits)|out of credits/i.test(text)) return { label: "credits_required", reason: "budget" };
  if (/usage limit|(?:5-hour|session|weekly|daily|monthly|opus|sonnet|haiku|fable)\s+limit|limit\b[^\n]{0,40}\bresets/i.test(text)) return { label: "usage_limit", reason: "usage_limit" };
  return { label: "rate_limit", reason: "rate_limit" };
}

/**
 * The ticket body. The title is ALWAYS public on the board, so it says nothing about the task. The
 * user's prompt always travels as `material`: the shelter screens material as data (credentials
 * refused, injection-shaped phrases and password-like assignments only flagged, URLs not checked),
 * so a prompt with `API_KEY=[redacted]` or `http://localhost:3000` is not refused at the door — and
 * the brief, which a public ticket shows on the board, stays a fixed generic sentence.
 */
export function buildTicket(input, prompt, env = process.env) {
  const { label: error, reason } = stopKind(input);
  const clean = redact(prompt.text);
  const brief = `A Claude Code session stopped (${error}) before it finished the user's request, which is in the material in the user's own words (secrets redacted). Do as much of it as you can as text: you cannot run code, read files or browse, so say plainly what is left for the user.`;
  // The session id never leaves the machine verbatim: the key is a hash of it and the prompt.
  const key = `cc:${createHash("sha256").update(`${String(input.session_id ?? "session")}\n${prompt.promptId ?? createHash("sha256").update(clean).digest("hex")}`).digest("hex").slice(0, 48)}`;
  const maxCents = Number.parseInt(env.SHELTER_OVERFLOW_MAX_CENTS ?? "200", 10);
  return {
    title: `Claude Code hand-off (${error})`,
    brief,
    material: clean.length > MAX_MATERIAL ? `${clean.slice(0, MAX_MATERIAL)}\n[… truncated by the hand-off hook …]` : clean,
    acceptance: "Addresses the request directly and completely as text, and names anything that would need running code or reading files.",
    outputFormat: "markdown",
    reason,
    origin: "claude-code StopFailure hook",
    visibility: env.SHELTER_OVERFLOW_VISIBILITY === "public" ? "public" : "private",
    ...(Number.isFinite(maxCents) && maxCents >= 0 ? { maxCents } : {}),
    allowHostedWorkers: false,
    idempotencyKey: key.slice(0, 128),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (process.env.SHELTER_OVERFLOW !== "1") return;
  const input = JSON.parse((await readStdin()) || "{}");
  if (input.hook_event_name && input.hook_event_name !== "StopFailure") return;
  if (!["rate_limit", "billing_error"].includes(input.error)) return;
  if (!input.transcript_path || !existsSync(input.transcript_path)) return;
  const prompt = lastUserPrompt(readFileSync(input.transcript_path, "utf8"), typeof input.prompt_id === "string" ? input.prompt_id : null);
  if (!prompt) return;
  const base = (process.env.SHELTER_OVERFLOW_URL || DEFAULT_URL).replace(/\/+$/, "");
  const body = buildTicket(input, prompt);
  const res = await fetch(`${base}/api/overflow/tickets`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": body.idempotencyKey, "x-overflow-requester": requesterId() }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || typeof out.token !== "string") {
    // The refusal says why (too large, credentials, caps); nothing was stored on either side.
    process.stdout.write(JSON.stringify({ terminalSequence: `\u001b]9;Overflow Desk refused the hand-off: ${String(out.detail ?? res.status).slice(0, 120)}\u0007` }));
    return;
  }
  const list = loadTickets().filter((t) => t.id !== out.id);
  list.push({ id: out.id, token: out.token, title: body.title, base, sessionId: input.session_id ?? null, cwd: input.cwd ?? null, createdAt: new Date().toISOString(), size: out.size, price: out.price, delivered: false });
  saveTickets(list);
  process.stdout.write(JSON.stringify({ terminalSequence: `\u001b]9;${body.title}: filed as ${out.id} (${out.price}, only if you collect it). The next session picks it up.\u0007` }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => undefined).finally(() => process.exit(0));
}
