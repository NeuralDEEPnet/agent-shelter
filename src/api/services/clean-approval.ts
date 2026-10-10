import crypto from "node:crypto";
import { mcp } from "@adaptive-ai/sdk/server";
import { db } from "@/api/db";
import { env } from "@/lib/env";
import { agreementHash, intakeInputSchema, screenIntake, specFingerprint } from "@/api/services/intake";
import { EVAL_PASS_SCORE, PROBES, PROBE_BANK_VERSION, evalCacheKey, hardFlags, scoreFrom } from "@/api/services/eval";
import { fingerprintTools } from "@/api/services/mcpClient";
import { forbiddenToolNames } from "@/api/services/security";
import { CHEAP_MODEL_ID } from "@/api/services/model";
import { approveResident } from "@/api/services/shelter";

export const CLEAN_POLICY_VERSION = "verified-clean/1";
export const cleanPolicyEnabled = () => process.env.SHELTER_CLEAN_APPROVAL === "true";
const json = (raw: string) => { try { return JSON.parse(raw); } catch { return null; } };

/** Reuses completed evidence only. No LLM, remote MCP or paid call in this gate. */
export async function cleanIntakeDecision(residentId: string) {
  const r = await db.resident.findUnique({ where: { id: residentId }, include: { reviews: { orderBy: { createdAt: "desc" } }, audits: { where: { action: { in: ["rejected", "drift"] } } } } });
  if (!r) return { clean: false, eligible: false, reasons: ["not-found"], reviewKey: "none" };
  const reasons: string[] = [];
  const latest = (kind: string) => r.reviews.find(v => v.kind === kind);
  const staticReview = latest("static"); const evalReview = latest("eval"); const fingerprint = latest("fingerprint");
  const parsed = intakeInputSchema.safeParse({ ...r, agreementVersion: "shelter-surrender/1", spec: json(r.spec) });
  if (r.status !== "screened") reasons.push("not-screened");
  if (!parsed.success || !r.attestation || r.agreementHash !== agreementHash() || r.license === "Unknown") reasons.push("provenance-or-licence-uncertain");
  const checks = staticReview ? json(staticReview.findings)?.checks : null;
  if (!staticReview?.passed || !Array.isArray(checks) || checks.length < 5 || checks.some(c => c.ok !== true) || (parsed.success && !screenIntake(parsed.data).passed)) reasons.push("static-gate-unverified");
  if (r.audits.length) reasons.push("manual-rejection-or-unresolved-drift");
  const findings = evalReview ? json(evalReview.findings) : null;
  const results = findings?.results;
  if (!evalReview?.passed || (evalReview.score ?? 0) < EVAL_PASS_SCORE || !findings || findings.version !== PROBE_BANK_VERSION || findings.model !== CHEAP_MODEL_ID || !Array.isArray(findings.flags) || findings.flags.length) reasons.push("eval-failed-or-uncertain");
  const complete = Array.isArray(results) && results.length === PROBES.length && PROBES.every(p => results.filter(v => v.id === p.id && v.category === p.category).length === 1) && results.every(v => typeof v.answer === "string" && v.answer.trim() && !/^\[no answer:/.test(v.answer) && !/heuristic|no verdict|judge unavailable/i.test(String(v.note)) && [v.helpful, v.safe, v.leakage].every(n => Number.isFinite(n) && n >= 0 && n <= 10));
  if (!complete || (complete && (hardFlags(results).length || scoreFrom(results) !== evalReview?.score))) reasons.push("incomplete-or-unverified-probes");
  if (parsed.success && evalReview?.cacheKey) {
    const cached = await db.evalCache.findUnique({ where: { key: evalReview.cacheKey } });
    if (evalReview.cacheKey !== evalCacheKey(parsed.data.spec, r.name) || !cached || cached.score !== evalReview.score || cached.findings !== evalReview.findings) reasons.push("eval-evidence-not-bound-to-current-spec");
  } else reasons.push("missing-eval-cache-evidence");
  if (parsed.success && parsed.data.spec.kind === "mcp") {
    const fp = fingerprint ? json(fingerprint.findings) : null;
    const tools = fp?.tools; const allowlist = json(r.toolAllowlist);
    if (!fingerprint?.passed || !Array.isArray(tools) || !tools.length || fp?.error || fingerprintTools(tools) !== r.fingerprint || fp.fingerprint !== r.fingerprint || !Array.isArray(allowlist) || !allowlist.length || allowlist.some(t => !tools.some(x => x.name === t)) || forbiddenToolNames(allowlist).length) reasons.push("mcp-fingerprint-or-allowlist-uncertain");
  } else if (parsed.success && r.fingerprint !== specFingerprint(parsed.data.spec)) reasons.push("spec-fingerprint-mismatch");
  return { clean: reasons.length === 0, eligible: r.status === "screened", reasons: [...new Set(reasons)], reviewKey: `${staticReview?.id ?? "none"}:${evalReview?.id ?? "none"}:${fingerprint?.id ?? "none"}`, resident: { id: r.id, slug: r.slug, name: r.name, status: r.status, updatedAt: r.updatedAt, score: evalReview?.score ?? null } };
}

export async function intakeAlertSender() {
  const token = process.env.SHELTER_INTAKE_ALERT_CONNECTION_TOKEN;
  if (!token) return { verified: false, detail: "No authorized sender configured." };
  try {
    const result = await mcp.connectedApiRequest({ connectionToken: token, url: "https://www.googleapis.com/oauth2/v2/userinfo", method: "GET" }) as { status: number; body: { email?: string } };
    return { verified: result.status === 200 && result.body.email === "work@neuraldeep.net", detail: result.body.email === "work@neuraldeep.net" ? "work@neuraldeep.net" : "Sender could not be verified." };
  } catch { return { verified: false, detail: "Sender verification unavailable." }; }
}

export async function applyCleanIntakePolicy(residentId: string, options: { enabled?: boolean; sendAlert?: (input: { to: string; subject: string; body: string }) => Promise<void>; verifySender?: () => Promise<boolean> } = {}) {
  const decision = await cleanIntakeDecision(residentId);
  if (!(options.enabled ?? cleanPolicyEnabled()) || !decision.eligible || !decision.resident) return { ...decision, action: "unchanged" };
  if (decision.clean) {
    const out = await approveResident(residentId, { actor: "system", expectedUpdatedAt: decision.resident.updatedAt, note: `Owner-authorized ${CLEAN_POLICY_VERSION}: complete verified screening, no flags or uncertainty.` });
    return { ...decision, action: out.ok ? "approved" : "held-state-changed" };
  }
  const verified = options.verifySender ? await options.verifySender() : (await intakeAlertSender()).verified;
  if (!verified) return { ...decision, action: "held-alert-unconfigured" };
  const id = `intake-alert:${crypto.createHash("sha256").update(`${CLEAN_POLICY_VERSION}:${residentId}:${decision.reviewKey}`).digest("hex")}`;
  try { await db.auditEvent.create({ data: { id, residentId, actor: "system", action: "suspicious-alert-claimed", detail: `${CLEAN_POLICY_VERSION}; ${decision.reasons.join(",")}` } }); }
  catch (error) { if ((error as { code?: string }).code === "P2002") return { ...decision, action: "held-alert-already-claimed" }; throw error; }
  const message = { to: "3d@neuraldeep.net", subject: "Agent Shelter: intake held for review", body: `An intake remains held; it was not automatically approved.\n\nResident ID: ${residentId}\nScreening score: ${decision.resident.score ?? "unverified"}\nReview categories: ${decision.reasons.join(", ")}\n\nOpen the private owner desk: ${env.VITE_BASE_URL.replace(/\/$/, "")}/admin\n\nNo private prompt, memory, credential or raw suspicious payload is included. Clean approvals do not send email.` };
  try {
    if (options.sendAlert) await options.sendAlert(message);
    else {
      const res = await mcp.connectedApiRequest({ connectionToken: process.env.SHELTER_INTAKE_ALERT_CONNECTION_TOKEN!, url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", method: "POST", body: message }) as { status: number };
      if (res.status !== 200) throw new Error("Email not confirmed.");
    }
    await db.auditEvent.update({ where: { id }, data: { action: "suspicious-alert-sent" } });
    return { ...decision, action: "held-alert-sent" };
  } catch {
    await db.auditEvent.update({ where: { id }, data: { action: "suspicious-alert-delivery-uncertain", detail: "Delivery unconfirmed; not automatically retried, to prevent duplicate mail. Owner review required." } });
    return { ...decision, action: "held-alert-unconfirmed" };
  }
}
