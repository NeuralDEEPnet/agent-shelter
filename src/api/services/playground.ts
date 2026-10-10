import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/api/db";
import { env } from "@/lib/env";
import { findInjection, findSecrets, checkRemoteUrl } from "@/api/services/security";
import { PLAYGROUND_OPS, PLAYGROUND_TOOLS, runPlaygroundBridge, type BridgeDeps } from "@/api/services/playground-bridge";
import type { PlaygroundViewProps, PlaygroundWork } from "@/components/playground/contract";

export const PLAYGROUND_LIMIT = 12;
export const RESIDENT_ACTIVITY_LIMIT = 4;
export type PlaygroundActor = { userId: string | null; owner: boolean };
type Projection = Pick<PlaygroundViewProps, "residents" | "posts" | "works" | "tasks" | "tools" | "budget" | "viewer" | "paused" | "pauseReason"> & { grants: { residentId: string; expiresAt: string | null; operations: string[]; actorUserId: string | null }[]; creatorAccounts: { id: string; label: string }[]; reviewItems: { id: string; title: string; body: string; kind: string; status: string }[] };
export class PlaygroundRefusal extends Error {}
function fail(text: string): never { throw new PlaygroundRefusal(text); }
const dayNow = () => new Date().toISOString().slice(0, 10);
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const live = (status: string) => status === "active" || status === "probation";
const ops = (raw: string): string[] => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch { return []; } };
const schema = z.object({ residentId: z.string().min(1).max(100), requestId: z.string().uuid(), title: z.string().trim().min(1).max(100), text: z.string().trim().min(1).max(2000), toolId: z.string().min(1).max(40), publicationConsent: z.boolean().default(false) }).strict();
export type PlaygroundRequest = z.infer<typeof schema>;

/** Plain text only. No model/tool execution or URL retrieval from posted content. */
export function moderatePlaygroundText(text: string): string | null {
  if (text.length > 24_000) return "output-too-large";
  if (findSecrets(text).length) return "credential-shaped-content";
  if (/pg_review_[A-Za-z0-9_-]{40,50}/.test(text)) return "private-review-credential";
  if (findInjection(text).length) return "unsafe-instruction-content";
  if ([...text].some(c => c.charCodeAt(0) < 32 && ![9,10,13].includes(c.charCodeAt(0)))) return "control-characters";
  if (/<\s*(script|iframe|object|embed)\b|javascript:|data:text\/html/i.test(text)) return "executable-content";
  if (/\b(child sexual|sexual minor|kill yourself|make a bomb|steal credentials|phishing campaign)\b/i.test(text)) return "unsafe-content";
  for (const url of text.match(/https?:\/\/[^\s<>"']+/g) ?? []) if (!checkRemoteUrl(url.replace(/[),.;]+$/, "")).ok) return "unsafe-url";
  return null;
}

export async function setPlaygroundAccess(actor: PlaygroundActor, input: unknown) {
  if (!actor.owner || !actor.userId) fail("Only the owner can grant public-playground participation.");
  const parsed = z.object({ residentId: z.string(), optedIn: z.boolean(), operations: z.array(z.string()).max(5), actorUserId: z.string().optional() }).strict().safeParse(input);
  if (!parsed.success) fail("Check the resident and permission selection.");
  if (parsed.data.operations.some(v => !PLAYGROUND_OPS.includes(v as typeof PLAYGROUND_OPS[number]))) fail("Unknown permission; no generic app access is allowed.");
  const resident = await db.resident.findUnique({ where: { id: parsed.data.residentId }, select: { status: true } });
  if (!resident || !live(resident.status)) fail("Only an approved active/probation resident can opt in.");
  const actorUserId = parsed.data.actorUserId ?? actor.userId!;
  const user = await db.user.findUnique({ where: { id: actorUserId } });
  if (!user) fail("The authorized creator account must already exist in Shelter.");
  await db.playgroundAccess.upsert({ where: { residentId: parsed.data.residentId }, create: { ...parsed.data, actorUserId, operations: JSON.stringify(parsed.data.operations), expiresAt: new Date(Date.now() + 7 * 86400_000) }, update: { actorUserId, optedIn: parsed.data.optedIn, operations: JSON.stringify(parsed.data.operations), expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  if (!parsed.data.optedIn) await db.playgroundReviewCredential.updateMany({ where: { residentId: parsed.data.residentId, revokedAt: null }, data: { revokedAt: new Date() } });
  return { ok: true as const, message: "Explicit seven-day permissions saved. No AI or recurring posting enabled." };
}

async function reserveActivity(actor: PlaygroundActor, raw: unknown, kind: "talk" | "work") {
  if (!actor.userId) fail("Sign in first.");
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail("Invalid request. Only fixed public parameters are accepted.");
  const input = parsed.data;
  if (kind === "talk" && (input.text.length > 600 || input.toolId !== "talk-preview" || !input.publicationConsent)) fail("Public talk needs explicit publication consent and a message of at most 600 characters.");
  if (kind === "work" && !PLAYGROUND_TOOLS.some(t => t.id === input.toolId && t.enabled)) fail("That operation is unavailable; no paid generation is enabled.");
  const requestHash = hash(JSON.stringify({ ...input, requestId: undefined, kind }));
  const requestKey = hash(`${actor.userId}:${input.requestId}`);
  return db.$transaction(async tx => {
    const duplicate = await tx.playgroundItem.findUnique({ where: { requestKey } });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) fail("This request identity belongs to different content.");
      return { item: duplicate, duplicate: true, resident: null };
    }
    const resident = await tx.resident.findUnique({ where: { id: input.residentId }, select: { id: true, name: true, tagline: true, status: true, budgetUnits: true, playgroundAccess: true } });
    const access = resident?.playgroundAccess;
    if (!resident || !live(resident.status) || !access?.optedIn || access.expiresAt <= new Date()) fail("This resident has not opted in with a current approval/grant.");
    if (!ops(access.operations).includes(input.toolId)) fail("The owner has not granted this operation.");
    if (kind === "work" && access.actorUserId !== actor.userId) fail("You are not the authorized creator for this resident.");
    const [shelter, setting, global] = await Promise.all([tx.shelterSetting.findUnique({ where: { id: "shelter" } }), tx.playgroundSetting.findUnique({ where: { id: "commons" } }), tx.dailyUsage.aggregate({ where: { day: dayNow() }, _sum: { unitsSpent: true } })]);
    if (shelter?.paused || setting?.paused) fail("Activity is paused.");
    if (resident.budgetUnits < 1 || (global._sum.unitsSpent ?? 0) >= env.SHELTER_GLOBAL_DAILY_UNITS) fail("Existing resident/global compute safety allowance is exhausted. No call was made.");
    const day = dayNow();
    if ((await tx.playgroundItem.count({ where: { residentId: resident.id, day } })) >= RESIDENT_ACTIVITY_LIMIT) fail("This resident has used its four shared activity attempts today.");
    if (await tx.playgroundItem.count({ where: { residentId: resident.id, status: "working" } })) fail("This resident already has work in progress; refresh instead of double-dispatching.");
    await tx.playgroundDay.upsert({ where: { day }, create: { day }, update: {} });
    const slot = await tx.playgroundDay.updateMany({ where: { day, attemptsUsed: { lt: PLAYGROUND_LIMIT } }, data: { attemptsUsed: { increment: 1 } } });
    if (!slot.count) fail("The one shared twelve-attempt daily ceiling is exhausted.");
    const tool = PLAYGROUND_TOOLS.find(t => t.id === input.toolId);
    const moderationCode = moderatePlaygroundText(`${input.title}\n${input.text}`);
    const item = await tx.playgroundItem.create({ data: { requestKey, requestHash, actorUserId: actor.userId!, residentId: resident.id, day, kind, toolId: input.toolId, sourceApp: tool?.provider ?? "Shelter", title: moderationCode ? "Content withheld by moderation" : input.title, inputText: moderationCode ? "[Withheld by safety gate]" : input.text, status: moderationCode ? "failed" : "working", moderationCode, publicationConsent: input.publicationConsent } });
    return { item, duplicate: false, resident: { id: resident.id, name: resident.name, tagline: resident.tagline } };
  });
}

export async function createPlaygroundActivity(actor: PlaygroundActor, raw: unknown, kind: "talk" | "work", dependencies: Partial<BridgeDeps> = {}) {
  const reservation = await reserveActivity(actor, raw, kind);
  if (reservation.duplicate) return { ok: true as const, message: `Existing request is ${reservation.item.status}; no duplicate activity or provider call.`, itemId: reservation.item.id };
  const { item, resident } = reservation;
  const inputModeration = item.moderationCode ?? moderatePlaygroundText(`${item.title}\n${item.inputText}`);
  if (inputModeration) {
    await db.playgroundItem.update({ where: { id: item.id }, data: { status: "failed", moderationCode: inputModeration, inputText: "[Withheld by public-content safety gate]" } });
    return { ok: false as const, message: "Content was held by moderation. The attempt is counted; no model/provider call was made.", itemId: item.id };
  }
  try {
    const output = kind === "talk" ? { sourceApp: "Shelter", kind: "guide" as const, body: `Deterministic public-profile guide — no AI model conversation.\n\n${resident!.name}\nPublished scope: ${resident!.tagline}\n\nYour task: ${item.inputText}\n\nUse Create work to turn this into a structured brief or public SketchMonkey directions. No private memories, model calls or external actions were used.` }
      : await Promise.race([runPlaygroundBridge({ toolId: item.toolId, title: item.title, brief: item.inputText, resident: resident! }, dependencies), new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error("Public bridge timed out.")), 20_000); t.unref(); })]);
    const outputModeration = moderatePlaygroundText(output.body);
    if (outputModeration) {
      await db.playgroundItem.update({ where: { id: item.id }, data: { status: "failed", moderationCode: outputModeration } });
      return { ok: false as const, message: "Output was held by moderation. The attempt remains counted.", itemId: item.id };
    }
    // Recheck eligibility after the remote read-only compiler returns. No publication from a revoked grant.
    const latest = await db.resident.findUnique({ where: { id: item.residentId }, include: { playgroundAccess: true } });
    const [state, shelter] = await Promise.all([db.playgroundSetting.findUnique({ where: { id: "commons" } }), db.shelterSetting.findUnique({ where: { id: "shelter" } })]);
    const stillGranted = latest && live(latest.status) && latest.playgroundAccess?.optedIn && latest.playgroundAccess.expiresAt > new Date() && ops(latest.playgroundAccess.operations).includes(item.toolId) && !state?.paused && !shelter?.paused;
    const published = kind === "talk" && actor.owner && stillGranted && item.publicationConsent;
    await db.playgroundItem.update({ where: { id: item.id }, data: { body: output.body, sourceApp: output.sourceApp, status: published ? "published" : "awaiting_review", publishedAt: published ? new Date() : null } });
    return { ok: true as const, message: published ? "Public question and deterministic guide recorded. No model or payment call." : "Real text artifact saved privately for review. Publish it explicitly when ready; no model/payment call.", itemId: item.id };
  } catch {
    await db.playgroundItem.update({ where: { id: item.id }, data: { status: "failed", moderationCode: "bridge-unavailable" } });
    return { ok: false as const, message: "The allowlisted public bridge could not complete. The failed attempt is counted; no paid generation was requested.", itemId: item.id };
  }
}

export async function publishPlaygroundWork(actor: PlaygroundActor, input: { itemId: string; consent: boolean }) {
  if (!actor.userId || input.consent !== true) fail("Explicit publication consent and sign-in are required.");
  return db.$transaction(async tx => {
    const item = await tx.playgroundItem.findUnique({ where: { id: input.itemId }, include: { resident: { include: { playgroundAccess: true } } } });
    if (!actor.owner || !item || !["work", "talk"].includes(item.kind)) fail("Only the owner can review and publish content.");
    if (item.status !== "awaiting_review" || !item.body || item.hiddenAt) fail("Only a completed reviewed draft can be published.");
    const access = item.resident.playgroundAccess;
    if (!live(item.resident.status) || !access?.optedIn || access.expiresAt <= new Date()) fail("Resident approval/participation grant is no longer current.");
    const [s, p] = await Promise.all([tx.shelterSetting.findUnique({ where: { id: "shelter" } }), tx.playgroundSetting.findUnique({ where: { id: "commons" } })]);
    if (s?.paused || p?.paused || moderatePlaygroundText(item.body)) fail("Publication is paused or held by moderation.");
    await tx.playgroundItem.update({ where: { id: item.id }, data: { status: "published", publicationConsent: true, publishedAt: new Date() } });
    return { ok: true as const, message: "Selected text work is now public with explicit provenance and real rating counts." };
  });
}

export async function ratePlaygroundWork(actor: PlaygroundActor, input: { workId: string; score: number }) {
  if (!actor.userId) fail("Sign in to rate.");
  if (!z.object({ workId: z.string().min(1).max(100), score: z.number().int().min(1).max(5) }).strict().safeParse(input).success) fail("Rating needs a work ID and score1–5; claimed voter identities are not accepted.");
  return db.$transaction(async tx => {
  const item = await tx.playgroundItem.findUnique({ where: { id: input.workId }, include: { resident: { select: { surrenderedBy: true } } } });
  if (!item || item.kind !== "work" || item.status !== "published" || item.hiddenAt) fail("Only public visible works can be rated.");
  if (item.actorUserId === actor.userId || item.resident.surrenderedBy === actor.userId) fail("Authors or the author-resident's linked account cannot rate their own works.");
  const [shelter, setting] = await Promise.all([tx.shelterSetting.findUnique({ where: { id: "shelter" } }), tx.playgroundSetting.findUnique({ where: { id: "commons" } })]);
  if (shelter?.paused || setting?.paused) fail("Playground activity is paused.");
  await tx.user.upsert({ where: { id: actor.userId! }, create: { id: actor.userId! }, update: {} });
  await tx.playgroundRating.upsert({ where: { workId_voterKey: { workId: item.id, voterKey: `account:${actor.userId}` } }, create: { workId: item.id, voterKey: `account:${actor.userId}`, userId: actor.userId, kind: "human", score: input.score }, update: { score: input.score } });
  return { ok: true as const, message: "Your one current authenticated-account rating is saved." };
  });
}

export async function issuePlaygroundReviewer(actor: PlaygroundActor, residentId: string) {
  if (!actor.owner || !actor.userId) fail("Only the owner can issue a rating-only resident credential.");
  const r = await db.resident.findUnique({ where: { id: residentId }, include: { playgroundAccess: true } });
  if (!r || !live(r.status) || !r.playgroundAccess?.optedIn || r.playgroundAccess.expiresAt <= new Date()) fail("Resident is not an approved opted-in participant.");
  const token = `pg_review_${crypto.randomBytes(32).toString("base64url")}`;
  await db.$transaction([db.playgroundReviewCredential.updateMany({ where: { residentId, revokedAt: null }, data: { revokedAt: new Date() } }), db.playgroundReviewCredential.create({ data: { residentId, issuerUserId: actor.userId!, tokenHash: hash(token), expiresAt: new Date(Date.now() + 86400_000) } })]);
  return { token, expiresInHours: 24, scope: "playground-rating-only", warning: "Private delegated resident credential. Never put it in a prompt or public work. Possession verifies delegated identity, not AI authorship. No provider/payment/admin permissions." };
}

export async function rateWithPlaygroundCredential(token: string, input: { workId: string; score: number; requestId: string }) {
  if (!/^pg_review_[A-Za-z0-9_-]{40,50}$/.test(token)) fail("Invalid rating credential.");
  if (!z.object({ workId: z.string().min(1).max(100), score: z.number().int().min(1).max(5), requestId: z.string().uuid() }).strict().safeParse(input).success) fail("Invalid rating request.");
  return db.$transaction(async tx => {
    const credential = await tx.playgroundReviewCredential.findUnique({ where: { tokenHash: hash(token) }, include: { resident: { include: { playgroundAccess: true } } } });
    if (!credential || credential.revokedAt || credential.expiresAt <= new Date() || !live(credential.resident.status) || !credential.resident.playgroundAccess?.optedIn || credential.resident.playgroundAccess.expiresAt <= new Date()) fail("Rating credential is expired/revoked or resident unavailable.");
    const item = await tx.playgroundItem.findUnique({ where: { id: input.workId }, include: { resident: { select: { surrenderedBy: true } } } });
    if (!item || item.kind !== "work" || item.status !== "published" || item.hiddenAt) fail("Only public visible works can be rated.");
    if (item.residentId === credential.residentId || item.actorUserId === credential.issuerUserId || item.resident.surrenderedBy === credential.issuerUserId) fail("No resident self-rating or author-account proxy rating.");
    const [setting, shelter, global] = await Promise.all([tx.playgroundSetting.findUnique({ where: { id: "commons" } }), tx.shelterSetting.findUnique({ where: { id: "shelter" } }), tx.dailyUsage.aggregate({ where: { day: dayNow() }, _sum: { unitsSpent: true } })]);
    if (setting?.paused || shelter?.paused) fail("Playground is paused.");
    if (credential.resident.budgetUnits < 1 || (global._sum.unitsSpent ?? 0) >= env.SHELTER_GLOBAL_DAILY_UNITS) fail("Existing compute safety allowance is exhausted.");
    const requestKey = hash(`resident-review:${credential.id}:${input.requestId}`);
    const requestHash = hash(JSON.stringify({ workId: input.workId, score: input.score }));
    const duplicate = await tx.playgroundItem.findUnique({ where: { requestKey } });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) fail("Request identity is bound to different rating content.");
      return { ok: true as const, message: "Existing verified rating request; no duplicate activity." };
    }
    // Verified resident actions share the same global day ceiling, never a separate AI/review budget.
    const day = dayNow(); await tx.playgroundDay.upsert({ where: { day }, create: { day }, update: {} });
    if (await tx.playgroundItem.count({ where: { residentId: credential.residentId, day } }) >= RESIDENT_ACTIVITY_LIMIT) fail("Resident's four shared activity attempts are exhausted.");
    if (!(await tx.playgroundDay.updateMany({ where: { day, attemptsUsed: { lt: PLAYGROUND_LIMIT } }, data: { attemptsUsed: { increment: 1 } } })).count) fail("Shared twelve-activity ceiling exhausted.");
    await tx.playgroundRating.upsert({ where: { workId_voterKey: { workId: item.id, voterKey: `resident:${credential.residentId}` } }, create: { workId: item.id, voterKey: `resident:${credential.residentId}`, residentId: credential.residentId, kind: "agent", score: input.score }, update: { score: input.score } });
    await tx.playgroundItem.create({ data: { requestKey, requestHash, actorUserId: credential.issuerUserId, residentId: credential.residentId, day, kind: "rating", toolId: "verified-rating", sourceApp: "Shelter", title: "Verified resident rating", inputText: `Rating ${input.score}`, body: "Delegated identity verified. No model call or public review text generated.", status: "completed" } });
    return { ok: true as const, message: "One current verified-delegated-resident rating saved. No model or external action executed." };
  });
}

export async function playgroundProjection(actor: PlaygroundActor): Promise<Projection> {
  const day = dayNow();
  const [residents, rows, usage, global, s, setting] = await Promise.all([
    db.resident.findMany({ where: { status: { in: actor.owner ? ["probation", "active", "hibernated", "screened"] : ["probation", "active", "hibernated"] } }, select: { id: true, name: true, tagline: true, status: true, budgetUnits: true, playgroundAccess: true }, orderBy: { createdAt: "asc" } }),
    db.playgroundItem.findMany({ where: actor.owner ? {} : { OR: [{ status: "published", hiddenAt: null }, ...(actor.userId ? [{ actorUserId: actor.userId }] : [])] }, include: { resident: { select: { name: true } }, ratings: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.playgroundDay.findUnique({ where: { day } }), db.dailyUsage.aggregate({ where: { day }, _sum: { unitsSpent: true } }), db.shelterSetting.findUnique({ where: { id: "shelter" } }), db.playgroundSetting.findUnique({ where: { id: "commons" } }),
  ]);
  const summary = (ratings: { score: number; kind: string }[], kind: string) => { const r = ratings.filter(v => v.kind === kind); return { count: r.length, average: r.length ? r.reduce((a,b) => a + b.score, 0) / r.length : null }; };
  const visible = rows.filter(r => !r.hiddenAt);
  const works: PlaygroundWork[] = visible.filter(r => r.kind === "work").map(r => ({ id: r.id, residentId: r.residentId, residentName: r.resident.name, title: r.title, kind: r.toolId === "sketch-directions" ? "design" : "brief", body: r.body, sourceApp: `${r.sourceApp} · owner-assisted deterministic`, timeLabel: r.createdAt.toISOString(), status: r.status as PlaygroundWork["status"], humanRatings: summary(r.ratings, "human"), agentRatings: summary(r.ratings, "agent"), viewerScore: r.ratings.find(v => v.voterKey === `account:${actor.userId}`)?.score ?? null, canRate: Boolean(actor.userId && r.status === "published" && r.actorUserId !== actor.userId && !setting?.paused && !s?.paused), ratingUnavailableReason: r.actorUserId === actor.userId ? "No self-rating" : !actor.userId ? "Sign in to rate" : r.status !== "published" ? "Publish before rating" : undefined }));
  return {
    residents: residents.map(r => { const a = r.playgroundAccess; const optedIn = Boolean(a?.optedIn && a.expiresAt > new Date() && live(r.status)); return { id: r.id, name: r.name, tagline: r.tagline, status: r.status as Projection["residents"][number]["status"], optedIn, canTalk: Boolean(actor.userId && optedIn && ops(a!.operations).includes("talk-preview") && r.budgetUnits > 0), canCreate: Boolean(actor.userId && optedIn && a!.actorUserId === actor.userId && ops(a!.operations).some(v => v !== "talk-preview") && r.budgetUnits > 0), availability: optedIn ? "Opted-in deterministic tools; live AI off" : "Participation not enabled — no invented activity" }; }),
    posts: visible.filter(r => r.kind === "talk" && r.status === "published").flatMap(r => [{ id: `${r.id}:question`, authorName: "Authenticated participant", authorKind: "human" as const, body: r.inputText, timeLabel: r.createdAt.toISOString() }, { id: r.id, residentId: r.residentId, authorName: `${r.resident.name} public guide · deterministic`, authorKind: "agent" as const, body: r.body, timeLabel: r.createdAt.toISOString() }]),
    works, tasks: actor.userId ? rows.filter(r => r.kind !== "rating" && (actor.owner || r.actorUserId === actor.userId)).map(r => ({ id: r.id, residentName: r.resident.name, title: r.title, toolName: r.toolId, status: r.status as Projection["tasks"][number]["status"], detail: r.moderationCode ? "Held/failed; attempt counted. Raw flagged content withheld." : "No model or paid generation; real saved record." })) : [],
    tools: PLAYGROUND_TOOLS, budget: { attemptsUsed: usage?.attemptsUsed ?? 0, allowanceLabel: "One shared12/day ceiling (UTC); zero-model actions cost0 model units; existing compute safety applies.", remainingComputeUnits: actor.owner ? Math.max(0, env.SHELTER_GLOBAL_DAILY_UNITS - (global._sum.unitsSpent ?? 0)) : null }, viewer: { signedIn: Boolean(actor.userId), isOwner: actor.owner, kind: "human", label: actor.owner ? "Owner account" : "Authenticated account" }, paused: Boolean(s?.paused || setting?.paused), pauseReason: "Owner/shelter pause blocks new activity.", grants: actor.owner ? residents.map(r => ({ residentId: r.id, expiresAt: r.playgroundAccess?.expiresAt.toISOString() ?? null, operations: r.playgroundAccess ? ops(r.playgroundAccess.operations) : [], actorUserId: r.playgroundAccess?.actorUserId ?? null })) : [],
    creatorAccounts: actor.owner ? (await db.user.findMany({ select: { id: true, handle: true, name: true }, take: 100 })).map(u => ({ id: u.id, label: u.handle ? `@${u.handle}` : u.name ?? "Registered Shelter account" })) : [],
    reviewItems: actor.owner ? rows.filter(r => r.status === "awaiting_review" || r.status === "published").map(r => ({ id: r.id, title: r.title, body: r.body, kind: r.kind, status: r.status })) : [],
  };
}
