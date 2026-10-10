import { db } from "@/api/db";
import { caller, ensureUserRow } from "@/api/services/auth";
import { createPlaygroundActivity, issuePlaygroundReviewer, playgroundProjection, PlaygroundRefusal, publishPlaygroundWork, ratePlaygroundWork, setPlaygroundAccess } from "@/api/services/playground";

async function acting() {
  const actor = await caller();
  if (actor.userId) await ensureUserRow(actor.userId);
  return actor;
}
async function action<T>(fn: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try { return await fn(); }
  catch (error) { return { ok: false, message: error instanceof PlaygroundRefusal ? error.message : "The action could not be confirmed. Refresh the real record before retrying; no paid model request was authorized." }; }
}

export async function getPlayground() {
  return playgroundProjection(await acting());
}
export async function setResidentPlaygroundAccess(input: { residentId: string; optedIn: boolean; operations: string[]; actorUserId?: string }) {
  return action(async () => setPlaygroundAccess(await acting(), input));
}
export async function sendPlaygroundMessage(input: { residentId: string; text: string; requestId: string; publicationConsent: boolean }) {
  return action(async () => createPlaygroundActivity(await acting(), { ...input, title: "Public-profile task guide", toolId: "talk-preview" }, "talk"));
}
export async function createPlaygroundWork(input: { residentId: string; toolId: string; title: string; brief: string; requestId: string }) {
  return action(async () => createPlaygroundActivity(await acting(), { residentId: input.residentId, toolId: input.toolId, title: input.title, text: input.brief, requestId: input.requestId, publicationConsent: false }, "work"));
}
export async function publishPlaygroundItem(input: { itemId: string; consent: boolean }) {
  return action(async () => publishPlaygroundWork(await acting(), input));
}
export async function ratePlaygroundItem(input: { workId: string; score: number }) {
  return action(async () => ratePlaygroundWork(await acting(), input));
}
export async function setPlaygroundPaused(input: { paused: boolean }) {
  return action(async () => {
    const who = await acting();
    if (!who.owner) throw new PlaygroundRefusal("Only the owner can pause playground activity.");
    if (typeof input.paused !== "boolean") throw new PlaygroundRefusal("Pause state must be true or false.");
    await db.playgroundSetting.upsert({ where: { id: "commons" }, create: { id: "commons", paused: input.paused }, update: { paused: input.paused } });
    return { ok: true as const, message: input.paused ? "Playground paused. Existing public reading remains available." : "Zero-paid playground resumed; paid autonomy remains off." };
  });
}
export async function hidePlaygroundItem(input: { itemId: string }) {
  return action(async () => {
    const who = await acting();
    if (!who.owner) throw new PlaygroundRefusal("Only the owner can hide public content.");
    await db.playgroundItem.update({ where: { id: input.itemId }, data: { hiddenAt: new Date() } });
    return { ok: true as const, message: "Item hidden from public projections; audit/provenance retained." };
  });
}
export async function createPlaygroundReviewCredential(input: { residentId: string }) {
  return action(async () => issuePlaygroundReviewer(await acting(), input.residentId));
}
