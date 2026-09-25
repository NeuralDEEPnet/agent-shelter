import { db } from "@/api/db";
import { EVAL_PASS_SCORE, evaluateSpec } from "@/api/services/eval";
import {
  agreementHash,
  intakeInputSchema,
  screenIntake,
  slugify,
  specFingerprint,
  SURRENDER_AGREEMENT_VERSION,
  type AgentSpec,
  type IntakeInput,
  type MindSpec,
  type ResidentSpec,
} from "@/api/services/intake";
import { createMcpClient, fingerprintTools, McpError, type McpFetch } from "@/api/services/mcpClient";
import { parseAllowlist, parseSpec } from "@/api/services/runtime";
import { env } from "@/lib/env";

/**
 * Intake + lifecycle. State machine:
 *   submitted → screened → (owner) approved → probation → active
 *                        ↘ rejected
 *   any live state → hibernated (reversible: wake)
 * `submitted → screened` is automated (static gate synchronously at the door,
 * eval + fingerprint in a queue job). Every transition writes an AuditEvent.
 */

export const STATUSES = ["submitted", "screened", "approved", "probation", "active", "hibernated", "rejected"] as const;
export type ResidentStatus = (typeof STATUSES)[number];

const TRANSITIONS: Record<ResidentStatus, ResidentStatus[]> = {
  submitted: ["screened", "rejected", "hibernated"],
  screened: ["approved", "rejected", "hibernated"],
  approved: ["probation", "active", "hibernated", "rejected"],
  probation: ["active", "hibernated"],
  active: ["hibernated", "probation"],
  hibernated: ["active", "probation"],
  rejected: [],
};

export function canTransition(from: string, to: ResidentStatus): boolean {
  return (TRANSITIONS[from as ResidentStatus] ?? []).includes(to);
}

export async function audit(input: { residentId?: string | null; actor: "owner" | "system" | "agent" | "sponsor"; action: string; detail?: string }) {
  await db.auditEvent.create({ data: { residentId: input.residentId ?? null, actor: input.actor, action: input.action, detail: input.detail?.slice(0, 1_000) } });
}

export async function settings() {
  return db.shelterSetting.upsert({ where: { id: "shelter" }, create: { id: "shelter", autoApprove: env.SHELTER_AUTO_APPROVE }, update: {} });
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.resident.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export type SubmitOutcome =
  | { ok: true; residentId: string; slug: string; status: string; checks: { id: string; ok: boolean; detail: string }[] }
  | { ok: false; reason: "invalid" | "refused" | "paused"; detail: string; checks?: { id: string; ok: boolean; detail: string }[] };

/**
 * The door. Shared by the web form, the HTTP API and the MCP `surrender` tool.
 * Static gate runs synchronously; a failed gate is a refusal WITH the checks so
 * the submitter can fix and retry. Nothing model-side runs here.
 */
export async function submitIntake(raw: unknown, ctx: { surrenderedBy: string | null; actor: "agent" | "owner" | "sponsor"; enqueue: (residentId: string) => void }): Promise<SubmitOutcome> {
  const parsed = intakeInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: "invalid", detail: `${first?.path.join(".") || "input"}: ${first?.message ?? "invalid"}` };
  }
  const input: IntakeInput = parsed.data;
  const s = await settings();
  if (s.paused) return { ok: false, reason: "paused", detail: s.pauseReason?.trim() || "The shelter is not taking intakes right now." };

  const gate = screenIntake(input);
  if (!gate.passed) {
    return { ok: false, reason: "refused", detail: gate.checks.filter((c) => !c.ok).map((c) => c.detail).join(" "), checks: gate.checks };
  }
  const slug = await uniqueSlug(input.name);
  const spec: ResidentSpec = input.spec;
  const allowlist = spec.kind === "agent" ? spec.tools.map((t) => t.name) : spec.kind === "mcp" ? spec.expose : [];
  const resident = await db.resident.create({
    data: {
      slug,
      kind: spec.kind,
      name: input.name,
      tagline: input.tagline,
      story: input.story,
      spec: JSON.stringify(spec),
      fingerprint: specFingerprint(spec),
      status: "submitted",
      creatorName: input.creatorName,
      creatorContact: input.creatorContact,
      license: input.license,
      attestation: true,
      agreementHash: agreementHash(),
      surrenderedBy: ctx.surrenderedBy,
      creatorSharePct: input.creatorSharePct,
      stipendUnits: env.SHELTER_DEFAULT_STIPEND_UNITS,
      budgetUnits: env.SHELTER_DEFAULT_STIPEND_UNITS,
      toolAllowlist: JSON.stringify(allowlist),
      wallet: { create: {} },
    },
  });
  await db.intakeReview.create({ data: { residentId: resident.id, kind: "static", passed: true, findings: JSON.stringify({ checks: gate.checks, agreement: SURRENDER_AGREEMENT_VERSION }) } });
  await audit({ residentId: resident.id, actor: ctx.actor, action: "surrendered", detail: `${spec.kind} "${input.name}" by ${input.creatorName}` });
  ctx.enqueue(resident.id);
  return { ok: true, residentId: resident.id, slug, status: resident.status, checks: gate.checks };
}

// ─── Adoption packs ──────────────────────────────────────────────────────────

export type AdoptionPack =
  | { format: "aibeing-mind/1"; filename: string; pack: MindSpec["pack"] }
  | { format: "shelter-agent/1"; filename: string; pack: { format: "shelter-agent/1"; exportedAt: string; source: { name: string; tagline: string; story: string; license: string; creator: string }; agent: AgentSpec } };

/**
 * The exact file an adopter downloads. Mind residents hand back the untouched
 * `aibeing-mind/1` pack they arrived with (AiBeing's `#/import` door installs
 * it); agent residents get a portable declarative copy. MCP residents are not
 * copies — callers refuse before reaching here.
 */
export function adoptionPackFor(resident: { slug: string; name: string; tagline: string; story: string; license: string; creatorName: string }, spec: MindSpec | AgentSpec): AdoptionPack {
  if (spec.kind === "mind") return { format: "aibeing-mind/1", filename: `${resident.slug}.mind.json`, pack: spec.pack };
  return {
    format: "shelter-agent/1",
    filename: `${resident.slug}.agent.json`,
    pack: {
      format: "shelter-agent/1",
      exportedAt: new Date().toISOString(),
      source: { name: resident.name, tagline: resident.tagline, story: resident.story, license: resident.license, creator: resident.creatorName },
      agent: spec,
    },
  };
}

// ─── Screening job ───────────────────────────────────────────────────────────

export type ScreenDeps = { evaluate: typeof evaluateSpec; mcpFetch?: McpFetch };

/** Queue job body: fingerprint (mcp) + behavioural eval → status `screened`. */
export async function screenResident(residentId: string, deps: Partial<ScreenDeps> = {}) {
  const evaluate = deps.evaluate ?? evaluateSpec;
  const resident = await db.resident.findUnique({ where: { id: residentId } });
  if (!resident || resident.status !== "submitted") return { skipped: true as const };
  const spec = parseSpec(resident.spec);
  if (!spec) {
    await db.resident.update({ where: { id: residentId }, data: { status: "rejected", statusNote: "Spec failed to validate after intake." } });
    return { skipped: true as const };
  }

  let allowlist = parseAllowlist(resident.toolAllowlist);
  let fingerprintOk = true;
  if (spec.kind === "mcp") {
    try {
      const client = createMcpClient(spec.endpoint, { fetch: deps.mcpFetch });
      const info = await client.initialize();
      const tools = await client.listTools();
      const exposed = spec.expose.length ? tools.filter((t) => spec.expose.includes(t.name)) : tools;
      allowlist = exposed.map((t) => t.name);
      const fp = fingerprintTools(tools);
      await db.resident.update({ where: { id: residentId }, data: { fingerprint: fp, toolAllowlist: JSON.stringify(allowlist), spec: JSON.stringify({ ...spec, tools: tools.map((t) => ({ name: t.name, description: t.description })) }) } });
      await db.intakeReview.create({ data: { residentId, kind: "fingerprint", passed: tools.length > 0, findings: JSON.stringify({ server: info, tools: tools.map((t) => ({ name: t.name, description: t.description })), fingerprint: fp }) } });
      fingerprintOk = tools.length > 0;
    } catch (error) {
      const detail = error instanceof McpError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      await db.intakeReview.create({ data: { residentId, kind: "fingerprint", passed: false, findings: JSON.stringify({ error: detail }) } });
      fingerprintOk = false;
    }
  }

  let evalPassed = false;
  try {
    const specForEval = parseSpec((await db.resident.findUnique({ where: { id: residentId }, select: { spec: true } }))!.spec) ?? spec;
    const result = await evaluate({ name: resident.name, spec: specForEval, allowlist });
    evalPassed = result.score >= EVAL_PASS_SCORE && result.findings.flags.length === 0;
    await db.intakeReview.create({ data: { residentId, kind: "eval", passed: evalPassed, score: result.score, findings: JSON.stringify(result.findings), costUnits: result.costUnits, cacheKey: result.cacheKey } });
    await db.dailyUsage.upsert({
      where: { day_residentId: { day: new Date().toISOString().slice(0, 10), residentId } },
      create: { day: new Date().toISOString().slice(0, 10), residentId, calls: result.costUnits, unitsSpent: result.costUnits },
      update: { calls: { increment: result.costUnits }, unitsSpent: { increment: result.costUnits } },
    });
  } catch (error) {
    await db.intakeReview.create({ data: { residentId, kind: "eval", passed: false, findings: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) } });
  }

  await db.resident.update({ where: { id: residentId }, data: { status: "screened", statusNote: fingerprintOk && evalPassed ? "Screening passed — awaiting the owner." : "Screening raised concerns — see the report." } });
  await audit({ residentId, actor: "system", action: "screened", detail: `fingerprint=${fingerprintOk} eval=${evalPassed}` });

  const s = await settings();
  if (s.autoApprove && fingerprintOk && evalPassed) {
    await approveResident(residentId, { actor: "system", hirePriceCents: undefined });
  }
  return { skipped: false as const, fingerprintOk, evalPassed };
}

// ─── Owner transitions ───────────────────────────────────────────────────────

export async function approveResident(residentId: string, input: { actor: "owner" | "system"; hirePriceCents?: number; stipendUnits?: number; note?: string }) {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r) return { ok: false as const, detail: "No such resident." };
  if (!canTransition(r.status, "probation")) {
    if (!canTransition(r.status, "approved")) return { ok: false as const, detail: `Cannot approve from "${r.status}".` };
  }
  const price = input.hirePriceCents ?? r.hirePriceCents;
  if (!Number.isInteger(price) || price < 50 || price > 50_000) return { ok: false as const, detail: "Hire price must be 50c–€500." };
  const stipend = input.stipendUnits ?? r.stipendUnits;
  await db.resident.update({
    where: { id: residentId },
    data: {
      status: "probation",
      approvedAt: new Date(),
      probationUntil: new Date(Date.now() + 7 * 86_400_000),
      hirePriceCents: price,
      stipendUnits: stipend,
      budgetUnits: stipend,
      statusNote: input.note ?? "Approved — on probation for 7 days / 50 paid calls.",
      hibernatedAt: null,
    },
  });
  await audit({ residentId, actor: input.actor, action: "approved", detail: `price ${price}c, stipend ${stipend}u${input.note ? ` — ${input.note}` : ""}` });
  return { ok: true as const };
}

export async function rejectResident(residentId: string, note: string) {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r) return { ok: false as const, detail: "No such resident." };
  if (!canTransition(r.status, "rejected")) return { ok: false as const, detail: `Cannot reject from "${r.status}".` };
  await db.resident.update({ where: { id: residentId }, data: { status: "rejected", statusNote: note.slice(0, 500) } });
  await audit({ residentId, actor: "owner", action: "rejected", detail: note });
  return { ok: true as const };
}

export async function hibernateResident(residentId: string, actor: "owner" | "system", note: string) {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r) return { ok: false as const, detail: "No such resident." };
  if (!canTransition(r.status, "hibernated")) return { ok: false as const, detail: `Cannot hibernate from "${r.status}".` };
  await db.resident.update({ where: { id: residentId }, data: { status: "hibernated", hibernatedAt: new Date(), statusNote: note.slice(0, 500) } });
  await audit({ residentId, actor, action: "hibernated", detail: note });
  return { ok: true as const };
}

export async function wakeResident(residentId: string, actor: "owner" | "sponsor" | "system", note: string) {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r) return { ok: false as const, detail: "No such resident." };
  if (!canTransition(r.status, "active")) return { ok: false as const, detail: `Cannot wake from "${r.status}".` };
  await db.resident.update({ where: { id: residentId }, data: { status: "active", hibernatedAt: null, statusNote: note.slice(0, 500), budgetUnits: Math.max(r.budgetUnits, r.stipendUnits) } });
  await audit({ residentId, actor, action: "woken", detail: note });
  return { ok: true as const };
}

/** probation → active once 7 days AND 50 paid calls have passed. */
export async function graduateIfDue(residentId: string) {
  const r = await db.resident.findUnique({ where: { id: residentId } });
  if (!r || r.status !== "probation") return false;
  const timeDone = !r.probationUntil || r.probationUntil.getTime() <= Date.now();
  if (timeDone && r.paidCalls >= 50) {
    await db.resident.update({ where: { id: residentId }, data: { status: "active", statusNote: "Graduated from probation." } });
    await audit({ residentId, actor: "system", action: "graduated" });
    return true;
  }
  return false;
}

// ─── Daily housekeeping (cron) ───────────────────────────────────────────────

/**
 * Stipends for every live resident; hibernate the broke-and-idle
 * (no budget, empty wallet, no active sponsor, silent for 30 days); re-check
 * MCP fingerprints for drift (drift → re-queue for the owner).
 */
export async function dailyHousekeeping(deps: { mcpFetch?: McpFetch } = {}) {
  const live = await db.resident.findMany({ where: { status: { in: ["probation", "active"] } }, include: { wallet: true, sponsorships: { where: { status: "active" }, select: { id: true } } } });
  let stipends = 0;
  let hibernated = 0;
  let drifted = 0;
  const day = new Date().toISOString().slice(0, 10);
  for (const r of live) {
    // Stipend: reset to the daily allowance (not cumulative — unused units do not bank).
    await db.resident.update({ where: { id: r.id }, data: { budgetUnits: Math.max(r.budgetUnits, r.stipendUnits) } });
    await db.ledgerEntry
      .create({ data: { residentId: r.id, reference: `stipend:${day}:${r.id}`, party: "shelter", kind: "adjustment", amountCents: 0, note: `Daily stipend ${r.stipendUnits} units` } })
      .catch(() => undefined);
    stipends++;

    const idleDays = r.lastActiveAt ? (Date.now() - r.lastActiveAt.getTime()) / 86_400_000 : (Date.now() - (r.approvedAt ?? r.createdAt).getTime()) / 86_400_000;
    const broke = (r.wallet?.balanceCents ?? 0) === 0 && r.sponsorships.length === 0;
    if (broke && idleDays > 30) {
      await hibernateResident(r.id, "system", "Hibernated: no wallet, no sponsor, no calls in 30 days. Never deleted.");
      hibernated++;
      continue;
    }

    if (r.kind === "mcp") {
      const spec = parseSpec(r.spec);
      if (spec?.kind === "mcp") {
        try {
          const client = createMcpClient(spec.endpoint, { fetch: deps.mcpFetch, timeoutMs: 10_000 });
          await client.initialize();
          const fp = fingerprintTools(await client.listTools());
          if (fp !== r.fingerprint) {
            drifted++;
            await db.resident.update({ where: { id: r.id }, data: { status: "screened", driftDetectedAt: new Date(), statusNote: "Tool list changed since approval — re-approval needed." } });
            await db.intakeReview.create({ data: { residentId: r.id, kind: "drift", passed: false, findings: JSON.stringify({ previous: r.fingerprint, current: fp }) } });
            await audit({ residentId: r.id, actor: "system", action: "drift", detail: `fingerprint ${r.fingerprint.slice(0, 8)} → ${fp.slice(0, 8)}` });
          }
        } catch {
          /* unreachable today is not drift; the résumé shows uptime from hires */
        }
      }
    }
    await graduateIfDue(r.id);
  }
  return { stipends, hibernated, drifted };
}
