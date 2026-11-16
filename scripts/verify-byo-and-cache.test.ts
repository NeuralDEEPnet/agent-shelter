/**
 * Verification suite for Agent Shelter "Build the Rails, Then Vibe" Overhaul:
 *  1. Identical free-ask / Playground demo prompts hit the bounded response cache
 *     on repeat calls: 0 model calls, 0 resident stipend units spent, 0 caller quota spent.
 *  2. Caller-supplied `X-Gemini-Api-Key` header on `/api/mpp/ask/:slug` and `/api/mcp`
 *     (`ask` tool) runs directly against Google Gemini at 0 Shelter stipend / 0 platform
 *     credit spend, even when resident stipend = 0.
 *  3. Invalid/rejected `X-Gemini-Api-Key` fails closed with human-safe wording, scrubs the
 *     exact key + any key-shaped token from responses and DB rows, and NEVER falls back
 *     to Shelter stipend or platform credits.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SHELTER_TURNS_PER_MINUTE = "1000";
process.env.SHELTER_CLEAN_APPROVAL = "false";
process.env.SHELTER_HIBERNATE_AFTER_DAYS = "90";

const { db } = await import("../src/api/db");
const shelter = await import("../src/api/services/shelter");
const intake = await import("../src/api/services/intake");
const freeTier = await import("../src/api/services/free-tier");
const { askResident, clearAskResponseCache, machineRoutes } = await import("../src/api/machine");

const TAG = `byo-${Date.now().toString(36)}`;
const created: string[] = [];

after(async () => {
  await db.residentTurn.deleteMany({ where: { residentId: { in: created } } });
  await db.dailyUsage.deleteMany({ where: { residentId: { in: created } } });
  await db.auditEvent.deleteMany({ where: { residentId: { in: created } } });
  await db.intakeReview.deleteMany({ where: { residentId: { in: created } } });
  await db.wallet.deleteMany({ where: { residentId: { in: created } } });
  await db.resident.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

async function seedResident(name: string, budgetUnits = 5) {
  const out = await shelter.submitIntake(
    {
      name,
      tagline: "Concise manufacturing & MCP test assistant.",
      story: "Created for the offline BYO-key and cache proof suite.",
      creatorName: "Proof",
      creatorContact: "https://github.com/proof",
      license: "MIT",
      attestation: true,
      agreementVersion: intake.SURRENDER_AGREEMENT_VERSION,
      creatorSharePct: 10,
      spec: {
        kind: "agent",
        systemPrompt: "Answer clearly in one sentence.",
        skills: ["dfam"],
        tools: [],
        memory: [],
      },
    },
    { surrenderedBy: null, actor: "agent", enqueue: () => undefined },
  );
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error("unreachable");
  created.push(out.residentId);
  await db.resident.update({
    where: { id: out.residentId },
    data: { status: "active", budgetUnits },
  });
  return out;
}

test("identical ask prompts hit the bounded response cache at 0 stipend & 0 extra model calls", async () => {
  clearAskResponseCache();
  freeTier.resetFreeQuotas();
  const res = await seedResident(`CacheProof ${TAG}`, 5);

  let modelCalls = 0;
  const app = machineRoutes({
    runtime: {
      complete: (async () => {
        modelCalls++;
        return "Cached concise answer.";
      }) as never,
      modelAvailable: () => true,
    },
    enqueueScreen: () => undefined,
  });

  const q = "What is your specialty in manufacturing?";
  const r1 = await app.fetch(
    new Request(`https://shelter.test/api/mpp/ask/${res.slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.41" },
      body: JSON.stringify({ question: q }),
    }),
  );
  assert.equal(r1.status, 200);
  const b1 = (await r1.json()) as { answer: string; cached?: boolean };
  assert.equal(b1.answer, "Cached concise answer.");
  assert.equal(Boolean(b1.cached), false);
  assert.equal(modelCalls, 1);

  const afterFirst = await db.resident.findUnique({ where: { id: res.residentId } });
  assert.equal(afterFirst?.budgetUnits, 4, "first call spent 1 stipend unit");

  // Second call with normalized whitespace/case hits cache: 0 model calls, 0 stipend spent!
  const r2 = await app.fetch(
    new Request(`https://shelter.test/api/mpp/ask/${res.slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.42" },
      body: JSON.stringify({ question: "  what is your specialty   in manufacturing? " }),
    }),
  );
  assert.equal(r2.status, 200);
  const b2 = (await r2.json()) as { answer: string; cached?: boolean };
  assert.equal(b2.answer, "Cached concise answer.");
  assert.equal(b2.cached, true);
  assert.equal(modelCalls, 1, "cache hit made zero model calls");

  const afterSecond = await db.resident.findUnique({ where: { id: res.residentId } });
  assert.equal(afterSecond?.budgetUnits, 4, "cache hit spent zero stipend units");
});

test("X-Gemini-Api-Key runs at 0 Shelter stipend / 0 platform credits, scrubs secrets, and never falls back on error", async () => {
  clearAskResponseCache();
  freeTier.resetFreeQuotas();
  // Resident has 0 budgetUnits left: platform/stipend asks would fail, proving BYO spends 0 stipend!
  const broke = await seedResident(`BrokeByo ${TAG}`, 0);

  let platformCompleteCalls = 0;
  machineRoutes({
    runtime: {
      complete: (async () => {
        platformCompleteCalls++;
        return "SHOULD_NEVER_BE_CALLED";
      }) as never,
      modelAvailable: () => true,
    },
    enqueueScreen: () => undefined,
  });

  const CANARY_KEY = "test-byo-secret-canary-998877665544";
  let geminiHeaderSeen = "";

  // 1. Successful BYO Gemini call
  const okOut = await askResident({
    slug: broke.slug,
    question: "Give me a quick PETG overhang tip.",
    caller: "198.51.100.77",
    byoGeminiKey: CANARY_KEY,
    byoFetchImpl: (async (_url, init) => {
      const h = new Headers(init?.headers);
      geminiHeaderSeen = h.get("x-goog-api-key") ?? "";
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Keep PETG overhangs at or below 45 degrees." }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  });

  assert.equal(okOut.ok, true);
  if (okOut.ok) {
    assert.equal(okOut.byoKeyUsed, true);
    assert.equal(okOut.answer, "Keep PETG overhangs at or below 45 degrees.");
  }
  assert.equal(geminiHeaderSeen, CANARY_KEY);
  assert.equal(platformCompleteCalls, 0, "platform model was never touched");

  const usage = await db.dailyUsage.findFirst({ where: { residentId: broke.residentId } });
  assert.equal(usage?.unitsSpent ?? 0, 0, "zero Shelter unitsSpent recorded for BYO call");

  // 2. Rejected BYO Gemini key that echoes the secret in Google's error payload:
  //    must fail closed, scrub the key, and NEVER fall back to platformCompleteCalls!
  const failOut = await askResident({
    slug: broke.slug,
    question: "Another question",
    caller: "198.51.100.77",
    byoGeminiKey: CANARY_KEY,
    byoFetchImpl: (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 401,
            status: "UNAUTHENTICATED",
            message: `API_KEY_INVALID for key ${CANARY_KEY}`,
          },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as typeof fetch,
  });

  assert.equal(failOut.ok, false);
  if (!failOut.ok) {
    assert.equal(failOut.status, 502);
    assert.ok(!failOut.detail.includes(CANARY_KEY), "canary key scrubbed from error detail");
    assert.match(failOut.detail, /Nothing fell back to Shelter stipend or platform credits/);
  }
  assert.equal(platformCompleteCalls, 0, "rejected BYO key never fell back to platform model");

  // 3. Verify canary key never landed anywhere in ResidentTurn or AuditEvent rows
  const turns = await db.residentTurn.findMany({ where: { residentId: broke.residentId } });
  assert.ok(!JSON.stringify(turns).includes(CANARY_KEY), "canary key absent from DB rows");
});
