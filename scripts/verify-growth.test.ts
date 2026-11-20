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
const head = (lastModified: string) => new Response(null, { status: 200, headers: { "last-modified": lastModified } });
const tarball = (name: string, v: string) => ({ tarball: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${v}.tgz` });
let calls: string[] = [];
/** A tiny fake of npm, PyPI and the GitHub API, shaped like their real answers (checked live 2026-11-20). */
const registry: McpFetch = async (url, init) => {
  calls.push(`${init?.method ?? "GET"} ${url}`);
  const npm = "https://registry.npmjs.org/";
  // abandoned: deprecated without a named successor, repository archived
  if (url === `${npm}dead-mcp/latest`) return json({ version: "0.3.1", description: "A dead MCP server", license: "MIT", deprecated: "Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived", repository: { url: "git+https://github.com/someone/dead-mcp.git" }, dist: tarball("dead-mcp", "0.3.1") });
  if (url === `${npm}dead-mcp/-/dead-mcp-0.3.1.tgz`) return head("Wed, 10 Jan 2024 00:00:00 GMT");
  if (url === "https://api.github.com/repos/someone/dead-mcp") return json({ archived: true });
  // moved: the notice names a published successor
  if (url === `${npm}old-mcp/latest`) return json({ version: "1.2.0", deprecated: "Renamed to @new/mcp. Install with: npm install -g @new/mcp", dist: tarball("old-mcp", "1.2.0") });
  if (url === `${npm}old-mcp/-/old-mcp-1.2.0.tgz`) return head("Mon, 01 Sep 2025 00:00:00 GMT");
  if (url === `${npm}@new%2Fmcp/latest`) return json({ version: "2.0.0" });
  // gone: npm knows the name, no version left
  if (url === `${npm}vanished-mcp/latest`) return new Response(JSON.stringify("version not found: latest"), { status: 404 });
  // maintained
  if (url === `${npm}@live%2Fmcp/latest`) return json({ version: "2.0.0", description: "Alive", license: "MIT", repository: "https://github.com/live/mcp", dist: tarball("@live/mcp", "2.0.0") });
  if (url === `${npm}@live/mcp/-/mcp-2.0.0.tgz`) return head("Thu, 01 Oct 2026 00:00:00 GMT");
  if (url === "https://api.github.com/repos/live/mcp") return json({ archived: false });
  // PyPI: stale, and a large project that needs the feed fallback, and an archived one
  if (url === "https://pypi.org/pypi/quiet-mcp/json") return json({ info: { version: "1.0", summary: "Quiet", license: "MIT", project_urls: {} }, urls: [{ upload_time_iso_8601: "2025-02-01T00:00:00Z" }] });
  if (url === "https://pypi.org/pypi/big-mcp/json") throw new Error("Response exceeded 262144 bytes.");
  if (url === "https://pypi.org/rss/project/big-mcp/releases.xml") return new Response(`<rss><channel><item><title>3.1.0</title><pubDate>Fri, 13 Nov 2026 10:14:50 GMT</pubDate></item></channel></rss>`, { status: 200 });
  if (url === "https://pypi.org/pypi/big-mcp/3.1.0/json") return json({ info: { version: "3.1.0", summary: "Big", license: "MIT", project_urls: {} } });
  if (url === "https://pypi.org/pypi/attic-mcp/json") return json({ info: { version: "0.9", summary: "Attic", classifiers: ["Development Status :: 7 - Inactive"], project_urls: {} }, urls: [{ upload_time_iso_8601: "2026-06-01T00:00:00Z" }] });
  if (url === "https://pypi.org/simple/attic-mcp/") return json({ "project-status": { status: "archived" } });
  if (url === `${npm}${TAG}-parked/latest`) return json({ version: "1.0.0", description: "Parked here", dist: tarball(`${TAG}-parked`, "1.0.0") });
  if (url.startsWith(`${npm}${TAG}-parked/-/`)) return head("Sun, 01 Nov 2026 00:00:00 GMT");
  return json({ error: "Not found" }, 404);
};

test("rescue check: verdicts follow the public signals", async () => {
  rescue.resetRescueCheck();
  const dead = await rescue.checkPackage({ registry: "npm", name: "dead-mcp" }, { fetch: registry, now: NOW });
  assert.ok(dead.ok);
  assert.equal(dead.check.verdict, "abandoned", "an archive link is not a successor");
  assert.equal(dead.check.successor, null);
  assert.equal(dead.check.repositoryArchived, true);
  assert.equal(dead.check.repository, "https://github.com/someone/dead-mcp");
  assert.equal(dead.check.install, "npx -y dead-mcp");
  assert.equal(dead.check.lastReleaseAt, "2024-01-10T00:00:00.000Z", "release date comes from the tarball");
  assert.ok(dead.check.signals.some((s) => s.includes("deprecated")));
  assert.ok(rescue.rescueLinks(dead.check, "https://x.test").surrender?.endsWith("/surrender?kind=package&registry=npm&name=dead-mcp"));
  assert.ok(!calls.some((c) => c === "GET https://registry.npmjs.org/dead-mcp"), "the oversized-prone packument is no longer read");

  const moved = await rescue.checkPackage({ name: "old-mcp" }, { fetch: registry, now: NOW });
  assert.ok(moved.ok);
  assert.equal(moved.check.verdict, "moved");
  assert.deepEqual([moved.check.successor?.name, moved.check.successor?.exists], ["@new/mcp", true]);
  const movedLinks = rescue.rescueLinks(moved.check, "https://x.test");
  assert.equal(movedLinks.surrender, null, "a moved package points at its successor, not at the shelter");
  assert.equal(movedLinks.successor, "https://x.test/check?registry=npm&name=%40new%2Fmcp");

  const gone = await rescue.checkPackage({ name: "vanished-mcp" }, { fetch: registry, now: NOW });
  assert.ok(gone.ok);
  assert.equal(gone.check.verdict, "gone");
  assert.equal(rescue.rescueLinks(gone.check, "https://x.test").surrender, null);

  const live = await rescue.checkPackage({ name: "@live/mcp" }, { fetch: registry, now: NOW });
  assert.ok(live.ok);
  assert.equal(live.check.verdict, "maintained");
  assert.equal(live.check.daysSinceRelease, 45);

  const quiet = await rescue.checkPackage({ registry: "pypi", name: "Quiet_MCP" }, { fetch: registry, now: NOW });
  assert.ok(quiet.ok);
  assert.equal(quiet.check.name, "quiet-mcp", "PyPI names are PEP 503-normalised");
  assert.equal(quiet.check.verdict, "stale");
  assert.equal(quiet.check.install, "uvx quiet-mcp");

  const big = await rescue.checkPackage({ registry: "pypi", name: "big-mcp" }, { fetch: registry, now: NOW });
  assert.ok(big.ok, "a project over the fetch cap falls back to the release feed instead of failing");
  assert.equal(big.check.latestVersion, "3.1.0");
  assert.equal(big.check.verdict, "maintained");

  const attic = await rescue.checkPackage({ registry: "pypi", name: "attic-mcp" }, { fetch: registry, now: NOW });
  assert.ok(attic.ok);
  assert.equal(attic.check.verdict, "abandoned");
  assert.ok(attic.check.signals.some((s) => s.includes("Inactive")));
  assert.ok(attic.check.signals.some((s) => s.includes("archived")));

  const missing = await rescue.checkPackage({ registry: "npm", name: "no-such-thing" }, { fetch: registry, now: NOW });
  assert.ok(missing.ok);
  assert.equal(missing.check.verdict, "not-found");
  assert.equal(rescue.rescueLinks(missing.check, "https://x.test").surrender, null);
});

test("successor parsing: real npm deprecation notices", () => {
  const cases: [string, string, string | null][] = [
    ["Renamed to @briangaoo/totem — install that instead.", "@briangaoo/whoop-mcp", "@briangaoo/totem"],
    ["This package has moved to ellmos-filecommander-mcp. Install: npm i -g ellmos-filecommander-mcp", "bach-filecommander-mcp", "ellmos-filecommander-mcp"],
    ["Renamed to release-auditor. Install with: npm install -g release-auditor", "agent-release-auditor", "release-auditor"],
    ["Renamed to @facthouse/mcp. This package is no longer published.", "@factmem/mcp", "@facthouse/mcp"],
    ["Omnicord is now discord-mcp: npx @orygn/discord-mcp init", "@orygn/omnicord", "@orygn/discord-mcp"],
    ["This package has moved to @browserbasehq/mcp", "@browserbasehq/mcp-server-browserbase", "@browserbasehq/mcp"],
    ["Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived", "@modelcontextprotocol/server-github", null],
    ["Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.", "@modelcontextprotocol/server-slack", null],
    ["deprecated", "x", null],
    ["Use this package instead of the old one", "x", null],
  ];
  for (const [notice, self, expected] of cases) assert.equal(rescue.successorFrom(notice, self)?.name ?? null, expected, notice);
  assert.equal(rescue.successorFrom("Retired. Migrate to host-native tools: https://github.com/levnikolaevich/claude-code-skills#migration-from-v1", "x")?.url, "https://github.com/levnikolaevich/claude-code-skills#migration-from-v1");
  assert.equal(rescue.successorFrom("Use the remote MCP server at https://mcp.neon.tech instead", "x")?.url, "https://mcp.neon.tech");
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
  assert.equal(again.ok && again.check.verdict, "abandoned");
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

test("stand-ins: the shelter's own re-implementations say so and never count as rescues", async () => {
  const { isStandIn } = await import("../src/api/services/stand-in");
  const { fosterRoutes } = await import("../src/api/foster");
  const { catalog } = await import("../src/api/machine");
  assert.equal(isStandIn({ kind: "mcp", endpoint: "https://x.test/api/foster/word/mcp" }), true);
  assert.equal(isStandIn({ kind: "mcp", endpoint: "https://elsewhere.test/mcp" }), false);
  assert.equal(isStandIn("not json"), false);

  const init = await fosterRoutes().request("/api/foster/word/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) });
  const result = ((await init.json()) as { result: { serverInfo: { name: string; version: string }; instructions: string } }).result;
  assert.match(result.serverInfo.name, /stand-in/);
  assert.notEqual(result.serverInfo.version, "1.1.11", "a stand-in does not report the upstream version as its own");
  assert.match(result.instructions, /not the original package code/);

  const before = (await catalog()).rescued;
  const r = await db.resident.create({
    data: {
      slug: `${TAG}-standin`, kind: "mcp", name: "Stand-in Proof", tagline: "A stand-in for the proof suite.", story: "Stand-in.", creatorName: "Upstream", creatorContact: "https://github.com/upstream", license: "MIT",
      spec: JSON.stringify({ kind: "mcp", endpoint: "https://agent-shelter.test/api/foster/word/mcp", tools: [] }), fingerprint: TAG, agreementHash: TAG, status: "active",
    },
  });
  created.push(r.id);
  const after = await catalog();
  assert.equal(after.rescued, before, "a stand-in is not a rescue");
  const row = after.residents.find((x) => x.slug === `${TAG}-standin`) as { standIn?: boolean; inHouse?: boolean } | undefined;
  assert.equal(row?.standIn, true);
  assert.equal(row?.inHouse, true);
  clearPrerenderCache();
  const page = await prerender(`/r/${TAG}-standin`);
  assert.match(page.html, /Shelter stand-in: a partial re-implementation/);
});
