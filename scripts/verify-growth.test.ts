// Growth-door proofs: the rescue check (HTTP + MCP), the README badge, the
// crawlable /check page and the one-click client links. Throwaway database,
// no network: every registry read goes through a stub.
//
//   npm test -- scripts/verify-growth.test.ts

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { McpFetch } from "../src/api/services/mcpClient";

const { db } = await import("../src/api/db");
const rescue = await import("../src/api/services/rescue-check");
const { residentBadgeSvg } = await import("../src/api/services/cards");
const { machineRoutes, handleMcp } = await import("../src/api/machine");
const { prerender, clearPrerenderCache } = await import("../src/api/services/prerender");
const { connectLinks } = await import("../src/lib/connect-links");
const { parsePath } = await import("../src/lib/router");

const TAG = `growth-${Date.now().toString(36)}`;
const NOW = Date.parse("2026-11-15T00:00:00Z");
const created: string[] = [];
after(async () => {
  await db.resident.deleteMany({ where: { id: { in: created } } });
  await db.$disconnect();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls: string[] = [];
/** A tiny fake of npm, PyPI and the GitHub API. */
const registry: McpFetch = async (url) => {
  calls.push(url);
  if (url === "https://registry.npmjs.org/dead-mcp/latest") return json({ version: "0.3.1", description: "A dead MCP server", license: "MIT", deprecated: "no longer maintained", repository: { url: "git+https://github.com/someone/dead-mcp.git" } });
  if (url === "https://registry.npmjs.org/dead-mcp") return json({ modified: "2024-01-10T00:00:00Z" });
  if (url === "https://api.github.com/repos/someone/dead-mcp") return json({ archived: true });
  if (url === "https://registry.npmjs.org/@live%2Fmcp/latest") return json({ version: "2.0.0", description: "Alive", license: "MIT", repository: "https://github.com/live/mcp" });
  if (url === "https://registry.npmjs.org/@live%2Fmcp") return json({ modified: "2026-10-01T00:00:00Z" });
  if (url === "https://api.github.com/repos/live/mcp") return json({ archived: false });
  if (url === "https://pypi.org/pypi/quiet-mcp/json") return json({ info: { version: "1.0", summary: "Quiet", license: "MIT", project_urls: {} }, urls: [{ upload_time_iso_8601: "2025-02-01T00:00:00Z" }] });
  if (url === `https://registry.npmjs.org/${TAG}-parked/latest`) return json({ version: "1.0.0", description: "Parked here" });
  if (url === `https://registry.npmjs.org/${TAG}-parked`) return json({ modified: "2026-11-01T00:00:00Z" });
  return json({ error: "not found" }, 404);
};

test("rescue check: verdicts follow the public signals", async () => {
  rescue.resetRescueCheck();
  const dead = await rescue.checkPackage({ registry: "npm", name: "dead-mcp" }, { fetch: registry, now: NOW });
  assert.ok(dead.ok);
  assert.equal(dead.check.verdict, "abandoned");
  assert.equal(dead.check.repositoryArchived, true);
  assert.equal(dead.check.repository, "https://github.com/someone/dead-mcp");
  assert.equal(dead.check.install, "npx -y dead-mcp");
  assert.ok(dead.check.signals.some((s) => s.includes("deprecated")));
  assert.ok(rescue.rescueLinks(dead.check, "https://x.test").surrender?.endsWith("/surrender?kind=package&registry=npm&name=dead-mcp"));

  const live = await rescue.checkPackage({ name: "@live/mcp" }, { fetch: registry, now: NOW });
  assert.ok(live.ok);
  assert.equal(live.check.verdict, "maintained");

  const quiet = await rescue.checkPackage({ registry: "pypi", name: "quiet-mcp" }, { fetch: registry, now: NOW });
  assert.ok(quiet.ok);
  assert.equal(quiet.check.verdict, "stale");
  assert.equal(quiet.check.install, "uvx quiet-mcp");

  const missing = await rescue.checkPackage({ registry: "npm", name: "no-such-thing" }, { fetch: registry, now: NOW });
  assert.ok(missing.ok);
  assert.equal(missing.check.verdict, "not-found");
  assert.equal(rescue.rescueLinks(missing.check, "https://x.test").surrender, null);
});

test("rescue check: refuses bad names before any network read, caches, and caps outbound reads", async () => {
  rescue.resetRescueCheck();
  calls = [];
  for (const name of ["../etc/passwd", "https://evil.test/x", "", "a b"]) {
    const out = await rescue.checkPackage({ registry: "npm", name }, { fetch: registry, now: NOW });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.status, 400);
  }
  const bad = await rescue.checkPackage({ registry: "cargo", name: "x" }, { fetch: registry, now: NOW });
  assert.equal(bad.ok, false);
  assert.equal(calls.length, 0);

  await rescue.checkPackage({ name: "dead-mcp" }, { fetch: registry, now: NOW });
  const before = calls.length;
  const again = await rescue.checkPackage({ name: "dead-mcp" }, { fetch: registry, now: NOW + 1000 });
  assert.ok(again.ok && again.cached);
  assert.equal(calls.length, before);

  rescue.resetRescueCheck();
  let refused = 0;
  for (let i = 0; i < 35; i++) {
    const out = await rescue.checkPackage({ name: `pkg-${i}` }, { fetch: registry, now: NOW });
    if (!out.ok && out.status === 429) refused++;
  }
  assert.equal(refused, 5);
});

test("rescue check: a package that lives here is 'sheltered' with résumé and badge links", async () => {
  rescue.resetRescueCheck();
  const r = await db.resident.create({
    data: {
      slug: `${TAG}-parked`, kind: "package", name: "Parked Proof", tagline: "Parked for the proof suite.", story: "Parked.", creatorName: "Proof", creatorContact: "https://github.com/proof", license: "MIT",
      spec: JSON.stringify({ kind: "package", registry: "npm", name: `${TAG}-parked`, tools: [] }), fingerprint: TAG, agreementHash: TAG, status: "active", freeCalls: 3, paidCalls: 1,
    },
  });
  created.push(r.id);
  const out = await rescue.checkPackage({ name: `${TAG}-parked` }, { fetch: registry, now: NOW });
  assert.ok(out.ok);
  assert.equal(out.check.verdict, "sheltered");
  const links = rescue.rescueLinks(out.check, "https://x.test");
  assert.equal(links.resume, `https://x.test/r/${TAG}-parked`);
  assert.equal(links.badge, `https://x.test/api/shelter/badge/${TAG}-parked.svg`);
  assert.equal(links.surrender, null);

  const app = machineRoutes({ registryFetch: registry });
  const http = await app.request(`/api/shelter/check?registry=npm&name=${TAG}-parked`);
  assert.equal(http.status, 200);
  const body = (await http.json()) as { verdict: string; links: { resume: string } };
  assert.equal(body.verdict, "sheltered");
  assert.ok(body.links.resume.endsWith(`/r/${TAG}-parked`));
  const invalid = await app.request("/api/shelter/check?registry=npm&name=..%2Fx");
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("content-type") ?? "", /problem\+json/);

  const badge = await app.request(`/api/shelter/badge/${TAG}-parked.svg`);
  assert.equal(badge.status, 200);
  assert.match(badge.headers.get("content-type") ?? "", /image\/svg\+xml/);
  const svg = await badge.text();
  assert.match(svg, /taking calls · 4 answered/);
  assert.equal((await app.request("/api/shelter/badge/nobody-here.svg")).status, 404);

  const mcp = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_package", arguments: { name: `${TAG}-parked` } } }, "proof-caller");
  const text = (mcp?.result as { content: { text: string }[] }).content[0]!.text;
  assert.equal((JSON.parse(text) as { verdict: string }).verdict, "sheltered");
});

test("badge: escapes names and reflects status", () => {
  const svg = residentBadgeSvg({ name: `<script>"x"</script>`, status: "hibernated", answered: 0 });
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, />hibernating</);
  assert.match(residentBadgeSvg({ name: "N", status: "submitted", answered: 9 }), />being screened</);
});

test("the /check page is crawlable, routed and in the sitemap; client links carry the MCP URL", async () => {
  clearPrerenderCache();
  const page = await prerender("/check");
  assert.equal(page.status, 200);
  assert.match(page.html, /Is this MCP server still looked after\?/);
  assert.match(page.html, /check_package/);
  assert.equal(parsePath("/check?registry=npm&name=x").name, "check");
  const sitemap = await (await machineRoutes().request("/api/shelter/sitemap.xml")).text();
  assert.match(sitemap, /\/check<\/loc>/);

  const links = connectLinks("https://x.test/");
  assert.equal(links.url, "https://x.test/api/mcp");
  assert.equal(links.claudeCode, "claude mcp add --transport http agent-shelter https://x.test/api/mcp");
  const cursorConfig = decodeURIComponent(links.cursor.split("config=")[1]!);
  assert.deepEqual(JSON.parse(Buffer.from(cursorConfig, "base64").toString("utf8")), { url: "https://x.test/api/mcp" });
  assert.deepEqual(JSON.parse(decodeURIComponent(links.vscode.replace("vscode:mcp/install?", ""))), { name: "agent-shelter", type: "http", url: "https://x.test/api/mcp" });
});
