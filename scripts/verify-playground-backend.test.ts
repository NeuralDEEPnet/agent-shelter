// Isolated migrated SQLite copy only. No real model, provider, payment or email calls.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db } from "../src/api/db";
import { createPlaygroundActivity, issuePlaygroundReviewer, moderatePlaygroundText, playgroundProjection, publishPlaygroundWork, ratePlaygroundWork, rateWithPlaygroundCredential, setPlaygroundAccess } from "../src/api/services/playground";
import { runPlaygroundBridge } from "../src/api/services/playground-bridge";

const tag = `pg-proof-${Date.now()}`;
assert.ok(process.env.DB_FILE_NAME?.includes("/tmp/opencode/"), "Never run this fixture suite on a live database.");
const a = { userId: `${tag}-a`, owner: true };
const b = { userId: `${tag}-b`, owner: false };
const c = { userId: `${tag}-c`, owner: true };
const anonymous = { userId: null, owner: false };
const ids: string[] = [];
const all = ["talk-preview", "shelter-brief", "sketch-directions", "sketch-preview", "3dj-status"];
const request = (residentId: string, extra = {}) => ({ residentId, requestId: crypto.randomUUID(), title: "A practical prototype brief", text: "A modular parts organizer for a small print farm. Confirm dimensions and material before manufacturing.", toolId: "shelter-brief", publicationConsent: false, ...extra });
async function clear() {
  await db.playgroundRating.deleteMany(); await db.playgroundReviewCredential.deleteMany(); await db.playgroundItem.deleteMany();
  await db.playgroundAccess.deleteMany(); await db.playgroundDay.deleteMany(); await db.playgroundSetting.deleteMany();
}
before(async () => {
  for (const actor of [a,b,c]) await db.user.create({ data: { id: actor.userId! } });
  for (let i = 0; i < 4; i++) {
    const r = await db.resident.create({ data: { name: `${tag} resident${i}`, slug: `${tag}-${i}`, kind: "agent", tagline: "Public prototype planning scope", story: "Public origin", spec: JSON.stringify({ kind: "agent", systemPrompt: "PRIVATE-PROMPT-MUST-NOT-LEAK", memory: ["PRIVATE-MEMORY-MUST-NOT-LEAK"] }), fingerprint: "test", status: "probation", creatorName: "Test author", creatorContact: "private-contact@example.com", license: "MIT", attestation: true, agreementHash: "test", budgetUnits: 20, stipendUnits: 20 } }); ids.push(r.id);
  }
});
beforeEach(async () => { await clear(); await db.shelterSetting.upsert({ where: { id: "shelter" }, create: { id: "shelter" }, update: { paused: false } }); await db.resident.updateMany({ where: { id: { in: ids } }, data: { status: "probation", budgetUnits: 20 } }); });
after(async () => { await clear(); await db.dailyUsage.deleteMany({ where: { residentId: { in: ids } } }); await db.resident.deleteMany({ where: { id: { in: ids } } }); await db.user.deleteMany({ where: { id: { in: [a.userId!,b.userId!,c.userId!] } } }); await db.$disconnect(); });

test("auth/opt-in/grants fail closed and no provider/working record is created for spoofed inputs", async () => {
  await assert.rejects(() => createPlaygroundActivity(anonymous, request(ids[0]), "work"));
  await assert.rejects(() => setPlaygroundAccess(b, { residentId: ids[0], optedIn: true, operations: all }));
  await assert.rejects(() => createPlaygroundActivity(a, request(ids[0]), "work"));
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: ["shelter-brief"] });
  await assert.rejects(() => createPlaygroundActivity(b, request(ids[0]), "work"));
  await assert.rejects(() => createPlaygroundActivity(a, request(ids[0], { toolId: "startImageGeneration" }), "work"));
  await assert.rejects(() => createPlaygroundActivity(a, { ...request(ids[0]), projectId: "private-project" }, "work"));
  assert.equal(await db.playgroundItem.count(), 0);
});

test("real draft persistence, nonce replay binding, explicit owner publication and public privacy", async () => {
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: all });
  const input = request(ids[0]); const created = await createPlaygroundActivity(a, input, "work");
  assert.ok(created.ok); const item = await db.playgroundItem.findUniqueOrThrow({ where: { id: created.itemId } });
  assert.equal(item.status, "awaiting_review"); assert.equal(item.modelUnits, 0);
  assert.equal((await playgroundProjection(anonymous)).works.length, 0);
  assert.ok((await createPlaygroundActivity(a, input, "work")).ok);
  assert.equal(await db.playgroundItem.count(), 1); assert.equal((await db.playgroundDay.findUniqueOrThrow({ where: { day: item.day } })).attemptsUsed, 1);
  await assert.rejects(() => createPlaygroundActivity(a, { ...input, text: "Changed content" }, "work"));
  await assert.rejects(() => publishPlaygroundWork(b, { itemId: item.id, consent: true }));
  await assert.rejects(() => publishPlaygroundWork(a, { itemId: item.id, consent: false }));
  await publishPlaygroundWork(a, { itemId: item.id, consent: true });
  const publicView = await playgroundProjection(anonymous);
  assert.equal(publicView.works.length, 1);
  const json = JSON.stringify(publicView);
  assert.ok(!json.includes("PRIVATE-PROMPT") && !json.includes("PRIVATE-MEMORY") && !json.includes("private-contact"));
  assert.equal(publicView.grants.length, 0); assert.equal(publicView.reviewItems.length, 0); assert.equal(publicView.creatorAccounts.length, 0);
  assert.equal(publicView.works[0].humanRatings.count, 0); assert.equal(publicView.works[0].agentRatings.count, 0);
});

test("moderation and provider failures are counted, secret content withheld, zero model units charged", async () => {
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: all });
  const blocked = await createPlaygroundActivity(a, request(ids[0], { text: "password=topsecret12345" }), "work");
  assert.equal(blocked.ok, false);
  const row = await db.playgroundItem.findUniqueOrThrow({ where: { id: blocked.itemId } });
  assert.ok(!row.inputText.includes("topsecret")); assert.equal(row.status, "failed");
  let providerCalls = 0;
  const failed = await createPlaygroundActivity(a, request(ids[0], { toolId: "sketch-directions" }), "work", { directions: async () => { providerCalls++; throw new Error("stub provider unavailable"); } });
  assert.equal(failed.ok, false); assert.equal(providerCalls, 1);
  assert.equal((await db.playgroundDay.findUniqueOrThrow({ where: { day: row.day } })).attemptsUsed, 2);
  assert.equal((await db.playgroundItem.aggregate({ _sum: { modelUnits: true } }))._sum.modelUnits, 0);
  assert.ok(moderatePlaygroundText(`pg_review_${"a".repeat(43)}`));
  assert.ok(moderatePlaygroundText("<script>evil()</script>"));
  assert.ok(moderatePlaygroundText("https://127.0.0.1/private"));
});

test("existing safety budgets, expiry, shelter pause and revoked approval block all creation", async () => {
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: all });
  await db.resident.update({ where: { id: ids[0] }, data: { budgetUnits: 0 } });
  await assert.rejects(() => createPlaygroundActivity(a, request(ids[0]), "work"));
  await db.resident.update({ where: { id: ids[0] }, data: { budgetUnits: 20 } });
  await db.shelterSetting.update({ where: { id: "shelter" }, data: { paused: true } });
  await assert.rejects(() => createPlaygroundActivity(a, request(ids[0]), "work"));
  await db.shelterSetting.update({ where: { id: "shelter" }, data: { paused: false } });
  await db.playgroundAccess.update({ where: { residentId: ids[0] }, data: { expiresAt: new Date(0) } });
  await assert.rejects(() => createPlaygroundActivity(a, request(ids[0]), "work"));
  assert.equal(await db.playgroundItem.count(), 0);
});

test("atomic shared GLOBAL12 ceiling and four-per-resident ceiling survive concurrent reservations", async () => {
  for (const id of ids) await setPlaygroundAccess(a, { residentId: id, optedIn: true, operations: all });
  const attempts = Array.from({ length: 32 }, (_, i) => createPlaygroundActivity(a, request(ids[i % ids.length]), "work"));
  await Promise.allSettled(attempts);
  const day = new Date().toISOString().slice(0,10);
  const used = await db.playgroundDay.findUniqueOrThrow({ where: { day } });
  assert.ok(used.attemptsUsed <= 12 && used.attemptsUsed > 0);
  assert.equal(used.attemptsUsed, await db.playgroundItem.count({ where: { day } }));
  for (const id of ids) assert.ok(await db.playgroundItem.count({ where: { residentId: id, day } }) <= 4);
});

test("account ratings are unique/current, no self-vote, hidden/private works cannot be rated", async () => {
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: all });
  const created = await createPlaygroundActivity(a, request(ids[0]), "work");
  await assert.rejects(() => ratePlaygroundWork(b, { workId: created.itemId, score: 4 }));
  await publishPlaygroundWork(a, { itemId: created.itemId, consent: true });
  await assert.rejects(() => ratePlaygroundWork(a, { workId: created.itemId, score: 5 }));
  await ratePlaygroundWork(b, { workId: created.itemId, score: 4 }); await ratePlaygroundWork(b, { workId: created.itemId, score: 5 });
  assert.equal(await db.playgroundRating.count(), 1);
  assert.equal((await playgroundProjection(anonymous)).works[0].humanRatings.average, 5);
  const spoof = { workId: created.itemId, score: 1, kind: "agent", residentId: ids[1] };
  await assert.rejects(() => ratePlaygroundWork(b, spoof));
  await db.playgroundItem.update({ where: { id: created.itemId }, data: { hiddenAt: new Date() } });
  await assert.rejects(() => ratePlaygroundWork(b, { workId: created.itemId, score: 2 }));
});

test("verified resident rating credentials are scoped/hashed/revocable with self/proxy prevention and shared caps", async () => {
  await setPlaygroundAccess(a, { residentId: ids[0], optedIn: true, operations: all });
  await setPlaygroundAccess(c, { residentId: ids[1], optedIn: true, operations: all });
  const work = await createPlaygroundActivity(a, request(ids[0]), "work"); await publishPlaygroundWork(a, { itemId: work.itemId, consent: true });
  const issued = await issuePlaygroundReviewer(c, ids[1]);
  assert.ok(!(await db.playgroundReviewCredential.findFirstOrThrow()).tokenHash.includes("pg_review_"));
  const input = { workId: work.itemId, score: 4, requestId: crypto.randomUUID() };
  await rateWithPlaygroundCredential(issued.token, input); await rateWithPlaygroundCredential(issued.token, input);
  assert.equal(await db.playgroundRating.count(), 1);
  const view = await playgroundProjection(anonymous);
  assert.equal(view.works[0].agentRatings.count, 1); assert.equal(view.works[0].humanRatings.count, 0);
  assert.equal((await db.playgroundDay.findUniqueOrThrow({ where: { day: new Date().toISOString().slice(0,10) } })).attemptsUsed, 2);
  await assert.rejects(() => rateWithPlaygroundCredential(issued.token, { ...input, score: 5 }));
  const self = await issuePlaygroundReviewer(c, ids[0]);
  await assert.rejects(() => rateWithPlaygroundCredential(self.token, { ...input, requestId: crypto.randomUUID() }));
  await setPlaygroundAccess(c, { residentId: ids[1], optedIn: false, operations: [] });
  await assert.rejects(() => rateWithPlaygroundCredential(issued.token, { ...input, requestId: crypto.randomUUID() }));
});

test("public bridge projection never forwards projects/private IDs; unknown operations reject", async () => {
  let previewInput: unknown;
  await runPlaygroundBridge({ toolId: "sketch-preview", title: "Brief", brief: "A small tray", resident: { name: "Public resident", tagline: "Public scope" } }, { preview: async input => { previewInput = input; return { resolved: "A safe public preview" }; } });
  const encoded = JSON.stringify(previewInput);
  assert.ok(!encoded.includes("projectId") && !encoded.includes("agentId") && !encoded.includes("history") && !encoded.includes("moodBoard"));
  await assert.rejects(() => runPlaygroundBridge({ toolId: "deleteGeneration", title: "No", brief: "No", resident: { name: "X", tagline: "Y" } }));
});
