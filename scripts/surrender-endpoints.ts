/**
 * Surrender a list of remote MCP endpoints (e.g. the servers you foster on the
 * box described in hosting/foster-host/) through the normal HTTP door, with the
 * ORIGINAL authors as creators.
 *
 *   npx tsx scripts/surrender-endpoints.ts hosting/foster-host/endpoints.json [--dry-run] [--origin https://…]
 *
 * Each entry: { name, tagline, story, creatorName, creatorContact, license, endpoint, expose?: string[], creatorSharePct?: number }
 * Prints one line per entry: slug + page on success, or the failing checks.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npx tsx scripts/surrender-endpoints.ts <endpoints.json> [--dry-run] [--origin <url>]");
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const origin = (args[args.indexOf("--origin") + 1] && args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://agent-shelter-neuraldeepnet.on.adaptive.ai")!.replace(/\/+$/, "");

type Entry = { name: string; tagline: string; story: string; creatorName: string; creatorContact: string; license: string; endpoint: string; expose?: string[]; creatorSharePct?: number };
const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];

for (const e of entries) {
  const body = {
    name: e.name,
    tagline: e.tagline,
    story: e.story,
    creatorName: e.creatorName,
    creatorContact: e.creatorContact,
    license: e.license,
    attestation: true,
    agreementVersion: "shelter-surrender/1",
    creatorSharePct: e.creatorSharePct ?? 10,
    spec: { kind: "mcp", endpoint: e.endpoint, expose: e.expose ?? [] },
  };
  if (dryRun) {
    console.log(JSON.stringify(body));
    continue;
  }
  const res = await fetch(`${origin}/api/shelter/surrender`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "agent-shelter-foster-host/1.0" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const out = (await res.json().catch(() => ({}))) as { accepted?: boolean; slug?: string; resume?: string; detail?: string; checks?: { id: string; ok: boolean; detail: string }[] };
  if (res.status === 201 && out.accepted) console.log(`${e.name}: landed as ${out.slug} → ${out.resume}`);
  else console.log(`${e.name}: HTTP ${res.status} — ${out.detail ?? "no detail"}${out.checks ? "\n  " + out.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join("\n  ") : ""}`);
}
