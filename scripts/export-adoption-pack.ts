/**
 * Network-free proof, Shelter half: a Mind-kind resident goes through the real
 * door (`submitIntake` — static gate + rows) and the real adoption pack builder
 * (`adoptionPackFor`, the same code `adoptResident` uses). The pack is written
 * to the path in argv[2] for AiBeing's `scripts/check-import-pack.ts` to
 * install. Throwaway rows are deleted before exit.
 *
 *   set -a; . ./.env.development; set +a
 *   npx tsx scripts/export-adoption-pack.ts /tmp/opencode/shelter-pack.json
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("usage: export-adoption-pack.ts <out.json>");
  process.exit(2);
}

const { db } = await import("../src/api/db");
const { submitIntake, adoptionPackFor } = await import("../src/api/services/shelter");
const { parseSpec } = await import("../src/api/services/runtime");

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const fixture = {
  name: `Proof Mind ${Date.now().toString(36)}`,
  tagline: "A Mind that arrived by adoption proof.",
  story: "Built for a marketplace demo, left behind when the demo ended. Kept here so the loop can be proven without a model call.",
  creatorName: "Proof Creator",
  creatorContact: "proof@example.com",
  license: "MIT",
  creatorSharePct: 10,
  attestation: true,
  agreementVersion: "shelter-surrender/1",
  spec: {
    kind: "mind",
    pack: {
      format: "aibeing-mind/1",
      exportedAt: new Date().toISOString(),
      source: {
        beingName: "Lantern",
        archetype: "companion",
        specialization: "notes",
        traits: ["patient", "exact"],
        tagline: "Keeps the porch light on.",
        generation: 2,
        evalScore: 0.75,
        rubricScore: 8,
        evalCount: 4,
        corpusGraded: 12,
      },
      mind: {
        voiceCard: "You are Lantern. Answer in short, warm sentences. Say what you will do before you do it.",
        rules: ["Name the next step before explaining it.", "Never guess a date; ask.", "Lantern signs off with one line, not a paragraph."],
        exemplars: [{ owner: "What should I do first?", being: "First, Lantern writes the one thing that is due today. Then the rest.", note: "graded good" }],
        memories: [{ layer: "profile", content: "Prefers bullet lists over prose.", topic: "format" }],
      },
    },
  },
};

const enqueued: string[] = [];
const outcome = await submitIntake(fixture, { surrenderedBy: null, actor: "agent", enqueue: (id) => enqueued.push(id) });
check("mind resident passes the door", outcome.ok, outcome.ok ? `slug ${outcome.slug}` : `${outcome.reason}: ${outcome.detail}`);
if (!outcome.ok) process.exit(1);
check("screening job enqueued once", enqueued.length === 1);

const resident = await db.resident.findUniqueOrThrow({ where: { id: outcome.residentId } });
const spec = parseSpec(resident.spec);
check("stored spec is a mind", spec?.kind === "mind");
if (!spec || spec.kind === "mcp") process.exit(1);
const adoption = adoptionPackFor(resident, spec);
check("adoption pack is aibeing-mind/1", adoption.format === "aibeing-mind/1" && adoption.filename === `${resident.slug}.mind.json`);
check(
  "pack is byte-identical to what arrived (rules, voice card, exemplars, memories)",
  JSON.stringify(adoption.pack) === JSON.stringify(fixture.spec.pack),
);

writeFileSync(out, JSON.stringify({ residentSlug: resident.slug, pack: adoption.pack }, null, 2));
console.log(`wrote ${out}`);

// cleanup — the proof leaves no resident behind
await db.intakeReview.deleteMany({ where: { residentId: resident.id } });
await db.auditEvent.deleteMany({ where: { residentId: resident.id } });
await db.wallet.deleteMany({ where: { residentId: resident.id } });
await db.resident.delete({ where: { id: resident.id } });
console.log(failures ? `${failures} FAILED` : "shelter half OK");
process.exit(failures ? 1 : 0);
