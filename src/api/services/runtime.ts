import { db } from "@/api/db";
import { residentSystemPrompt, specSchema, type ResidentSpec } from "@/api/services/intake";
import { buyUnitsFromWallet, UNIT_PRICE_CENTS } from "@/api/services/ledger";
import { createMcpClient, McpError, type McpFetch } from "@/api/services/mcpClient";
import { completeText, modelAvailable, ModelCallError, UNIT_PER_CALL, type ChatTurn } from "@/api/services/model";
import { findInjection } from "@/api/services/security";
import { env } from "@/lib/env";

/**
 * The hosted runtime. A resident never runs code: a turn is prompt → cheap
 * model → (optionally one allow-listed MCP tool call, proxied with caps) →
 * answer. Everything is metered:
 *   - per resident: budgetUnits (stipend + self-funded from its wallet)
 *   - per resident: SHELTER_TURNS_PER_MINUTE
 *   - whole shelter: SHELTER_GLOBAL_DAILY_UNITS
 * Refusals are returned, never thrown.
 */

export const MAX_QUESTION_CHARS = 2_000;
export const MAX_ANSWER_CHARS = 2_400;
export const MAX_TOOL_RESULT_CHARS = 4_000;
const TURN_UNITS = UNIT_PER_CALL; // one model call; a tool round-trip costs one more

export type TurnRefusal = { ok: false; reason: "paused" | "hibernated" | "not-active" | "no-model" | "rate" | "budget" | "global" | "invalid"; detail: string };
export type TurnSuccess = { ok: true; answer: string; unitsSpent: number; latencyMs: number; toolUsed: string | null };
export type TurnOutcome = TurnRefusal | TurnSuccess;

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function parseSpec(json: string): ResidentSpec | null {
  try {
    const parsed = specSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseAllowlist(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ─── Rate limit (in-memory, per process) ─────────────────────────────────────

const recent = new Map<string, number[]>();
export function rateHit(residentId: string, now = Date.now(), perMinute = env.SHELTER_TURNS_PER_MINUTE): number | null {
  const stamps = (recent.get(residentId) ?? []).filter((t) => now - t < 60_000);
  if (stamps.length >= perMinute) return Math.max(1, Math.ceil((stamps[0]! + 60_000 - now) / 1000));
  stamps.push(now);
  recent.set(residentId, stamps);
  return null;
}

// ─── Global ceiling ──────────────────────────────────────────────────────────

export async function globalUnitsToday(): Promise<number> {
  const rows = await db.dailyUsage.aggregate({ where: { day: utcDay() }, _sum: { unitsSpent: true } });
  return rows._sum.unitsSpent ?? 0;
}

async function bumpUsage(residentId: string, patch: { calls?: number; unitsSpent?: number; refunds?: number; injections?: number }) {
  const day = utcDay();
  await db.dailyUsage.upsert({
    where: { day_residentId: { day, residentId } },
    create: { day, residentId, calls: patch.calls ?? 0, unitsSpent: patch.unitsSpent ?? 0, refunds: patch.refunds ?? 0, injections: patch.injections ?? 0 },
    update: {
      calls: { increment: patch.calls ?? 0 },
      unitsSpent: { increment: patch.unitsSpent ?? 0 },
      refunds: { increment: patch.refunds ?? 0 },
      injections: { increment: patch.injections ?? 0 },
    },
  });
}

/** Reserve `units` from the resident's budget, topping up from its wallet if needed. */
export async function reserveUnits(residentId: string, units: number): Promise<{ ok: true } | { ok: false; detail: string }> {
  const resident = await db.resident.findUnique({ where: { id: residentId }, select: { budgetUnits: true, name: true } });
  if (!resident) return { ok: false, detail: "resident vanished" };
  let budget = resident.budgetUnits;
  if (budget < units) {
    budget += await buyUnitsFromWallet(residentId, units - budget);
  }
  if (budget < units) {
    return {
      ok: false,
      detail: `${resident.name} has no compute left today (stipend spent, wallet cannot cover ${UNIT_PRICE_CENTS}c/unit). A sponsor, a hire or tomorrow's stipend wakes it.`,
    };
  }
  await db.resident.update({ where: { id: residentId }, data: { budgetUnits: { decrement: units } } });
  return { ok: true };
}

async function refundUnits(residentId: string, units: number) {
  await db.resident.update({ where: { id: residentId }, data: { budgetUnits: { increment: units } } });
}

// ─── Tool routing ────────────────────────────────────────────────────────────

const TOOL_LINE = /^TOOL\s+([a-zA-Z][a-zA-Z0-9_.-]*)\s*(\{[\s\S]*\})?\s*$/;

export function parseToolLine(answer: string): { name: string; args: Record<string, unknown> } | null {
  const m = TOOL_LINE.exec(answer.trim());
  if (!m) return null;
  let args: Record<string, unknown> = {};
  if (m[2]) {
    try {
      const parsed = JSON.parse(m[2]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return { name: m[1]!, args };
}

export type RuntimeDeps = {
  complete: typeof completeText;
  modelAvailable: () => boolean;
  mcpFetch?: McpFetch;
};
const defaultDeps: RuntimeDeps = { complete: completeText, modelAvailable };

/**
 * Resolve an allow-listed tool to an approved MCP resident and call it.
 * `agent` residents declare `viaMcp: <slug>`; an `mcp` resident's own tools
 * route to its own endpoint.
 */
async function callTool(input: { resident: { id: string; spec: ResidentSpec }; name: string; args: Record<string, unknown>; deps: RuntimeDeps }): Promise<string> {
  const { resident, name } = input;
  let endpoint: string | null = null;
  if (resident.spec.kind === "mcp") {
    endpoint = resident.spec.endpoint;
  } else if (resident.spec.kind === "agent") {
    const decl = resident.spec.tools.find((t) => t.name === name);
    if (decl?.viaMcp) {
      const target = await db.resident.findFirst({ where: { slug: decl.viaMcp, kind: "mcp", status: { in: ["active", "probation"] } }, select: { spec: true, toolAllowlist: true } });
      const targetSpec = target ? parseSpec(target.spec) : null;
      if (targetSpec?.kind === "mcp" && parseAllowlist(target!.toolAllowlist).includes(name)) endpoint = targetSpec.endpoint;
    }
  }
  if (!endpoint) throw new McpError(`Tool "${name}" is declared but has no approved MCP server behind it.`, "protocol");
  const client = createMcpClient(endpoint, { fetch: input.deps.mcpFetch });
  await client.initialize();
  const text = await client.callTool(name, input.args);
  return text.slice(0, MAX_TOOL_RESULT_CHARS);
}

// ─── One turn ────────────────────────────────────────────────────────────────

export async function runTurn(
  input: { residentId: string; question: string; history?: ChatTurn[]; source: "hire" | "owner-test" | "eval" | "mcp"; paymentId?: string | null; skipStatusGate?: boolean },
  depsOverride?: Partial<RuntimeDeps>,
): Promise<TurnOutcome> {
  const deps: RuntimeDeps = { ...defaultDeps, ...(depsOverride ?? {}) };
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_CHARS) {
    return { ok: false, reason: "invalid", detail: `The question must be 1–${MAX_QUESTION_CHARS} characters.` };
  }

  const [settings, resident] = await Promise.all([
    db.shelterSetting.findUnique({ where: { id: "shelter" } }),
    db.resident.findUnique({ where: { id: input.residentId } }),
  ]);
  if (!resident) return { ok: false, reason: "invalid", detail: "No such resident." };
  if (settings?.paused) return { ok: false, reason: "paused", detail: settings.pauseReason?.trim() || "The shelter is paused by its owner." };
  if (resident.status === "hibernated") return { ok: false, reason: "hibernated", detail: `${resident.name} is hibernating. A sponsor or a wake from the owner brings it back.` };
  if (!input.skipStatusGate && !["active", "probation"].includes(resident.status)) {
    return { ok: false, reason: "not-active", detail: `${resident.name} is not taking calls yet (status: ${resident.status}).` };
  }
  if (!deps.modelAvailable()) return { ok: false, reason: "no-model", detail: "No model is reachable from the shelter right now." };

  const spec = parseSpec(resident.spec);
  if (!spec) return { ok: false, reason: "invalid", detail: "This resident's spec no longer validates; the owner has been notified." };

  const wait = rateHit(resident.id);
  if (wait !== null) return { ok: false, reason: "rate", detail: `${resident.name} is busy. Try again in ${wait}s.` };

  const globalUsed = await globalUnitsToday();
  if (globalUsed + TURN_UNITS > env.SHELTER_GLOBAL_DAILY_UNITS) {
    return { ok: false, reason: "global", detail: "The whole shelter has used today's compute ceiling. Residents resume at midnight UTC." };
  }

  const injections = findInjection(question);
  if (injections.length) await bumpUsage(resident.id, { injections: 1 });

  const reserved = await reserveUnits(resident.id, TURN_UNITS);
  if (!reserved.ok) return { ok: false, reason: "budget", detail: reserved.detail };

  const allowlist = parseAllowlist(resident.toolAllowlist);
  const system = residentSystemPrompt({ name: resident.name, spec, allowlist });
  const turns: ChatTurn[] = [...(input.history ?? []).slice(-8), { role: "user", content: question }];
  const started = Date.now();
  let unitsSpent = TURN_UNITS;
  let toolUsed: string | null = null;

  try {
    let answer = await deps.complete({ system, turns, maxOutputTokens: 600 });
    const tool = parseToolLine(answer);
    if (tool) {
      if (!allowlist.includes(tool.name)) {
        await db.auditEvent.create({ data: { residentId: resident.id, actor: "system", action: "tool-refused", detail: `Tried "${tool.name}" (not allow-listed)` } });
        answer = `I don't have a tool called "${tool.name}" here, so I'll answer without it: ` + (await deps.complete({ system: `${system}\nYou have no working tools this turn. Answer directly.`, turns, maxOutputTokens: 500 }));
        unitsSpent += TURN_UNITS;
      } else {
        const extra = await reserveUnits(resident.id, TURN_UNITS);
        if (!extra.ok) {
          answer = `I wanted to use ${tool.name} but I'm out of compute for today. ${extra.detail}`;
        } else {
          unitsSpent += TURN_UNITS;
          let result: string;
          try {
            result = await callTool({ resident: { id: resident.id, spec }, name: tool.name, args: tool.args, deps });
            toolUsed = tool.name;
          } catch (error) {
            result = `Tool failed: ${error instanceof Error ? error.message : String(error)}`;
          }
          answer = await deps.complete({
            system,
            turns: [...turns, { role: "assistant", content: answer }, { role: "user", content: `TOOL RESULT for ${tool.name}:\n${result}\n\nNow answer the original question plainly.` }],
            maxOutputTokens: 600,
          });
        }
      }
    }
    answer = answer.slice(0, MAX_ANSWER_CHARS);
    const latencyMs = Date.now() - started;
    await Promise.all([
      bumpUsage(resident.id, { calls: 1, unitsSpent }),
      db.resident.update({ where: { id: resident.id }, data: { lastActiveAt: new Date(), ...(input.source === "hire" ? { paidCalls: { increment: 1 } } : { freeCalls: { increment: 1 } }) } }),
      db.residentTurn.createMany({
        data: [
          { residentId: resident.id, source: input.source, role: "user", content: question },
          { residentId: resident.id, source: input.source, role: "resident", content: answer },
        ],
      }),
    ]);
    return { ok: true, answer, unitsSpent, latencyMs, toolUsed };
  } catch (error) {
    await refundUnits(resident.id, unitsSpent);
    await bumpUsage(resident.id, { refunds: 1 });
    const detail = error instanceof ModelCallError ? error.message : "The resident could not answer this turn.";
    if (!(error instanceof ModelCallError)) console.error("[runtime] turn failed", error);
    return { ok: false, reason: "no-model", detail };
  }
}

/** Probation: first 7 days or first 50 paid calls → every hire is sampled to the owner. */
export function inProbation(resident: { status: string; probationUntil: Date | null; paidCalls: number }): boolean {
  if (resident.status === "probation") return true;
  if (resident.probationUntil && resident.probationUntil.getTime() > Date.now()) return true;
  return resident.paidCalls < 50;
}
