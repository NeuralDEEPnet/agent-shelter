import { test } from "node:test";
import assert from "node:assert/strict";
import { injectFragment, staticDiscovery, outageFragment } from "../vite.prerender-plugin";
import { matchesResidentSearch } from "../src/lib/resident-search";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("API outages retain allowlisted static documents instead of returning SPA HTML", () => {
  for (const path of ["/about.md", "/llms.txt", "/sitemap.xml", "/openapi.json", "/.well-known/mcp.json", "/whitepaper.md"]) {
    const document = staticDiscovery(path, resolve("public"));
    assert.ok(document, path); assert.ok(!document.body.toString().includes('<div id="root">'));
    if (path.endsWith(".json")) assert.doesNotThrow(() => JSON.parse(document.body.toString()));
  }
  assert.equal(staticDiscovery("/../package.json", resolve("public")), null);
  assert.equal(staticDiscovery("/.env.production", resolve("public")), null);
});

test("outage pages describe the shelter without inventing resident availability", () => {
  for (const path of ["/", "/directory", "/surrender", "/machine"]) {
    const f = outageFragment(path);
    assert.equal(f.status, 200); assert.ok(f.html.includes("temporarily unavailable"));
    assert.ok(f.html.includes("humans, bots, AIs"));
  }
  const resident = outageFragment("/r/private-or-unknown");
  assert.notEqual(resident.status, 200); assert.equal(resident.jsonLd, null);
  assert.ok(!resident.html.includes("private-or-unknown"));
  const html = injectFragment(readFileSync("index.html", "utf8"), resident);
  assert.ok(html.includes('name="robots" content="noindex"'));
  assert.ok(html.includes("<main>"));
});

test("metadata injector replaces static home signals with one route-specific set", () => {
  const template = readFileSync("index.html", "utf8") + '<meta property="og:title" content="old"><script type="application/ld+json">{"old":true}</script>';
  const html = injectFragment(template, { status: 200, title: "Resident X", description: "Actual profile", canonical: "https://example.com/r/x", html: "<h1>Resident X</h1>", jsonLd: { "@type": "Service", name: "Resident X" } });
  assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
  assert.equal((html.match(/property="og:title"/g) ?? []).length, 1);
  assert.equal((html.match(/application\/ld\+json/g) ?? []).length, 1);
  assert.ok(html.includes('href="https://example.com/r/x"'));
  assert.ok(!html.includes('"old":true'));
});

test("private/unknown prerenders are noindex and attributes escape malicious strings", () => {
  const html = injectFragment('<html><head><title>Old</title></head><body><div id="root"></div></body></html>', { status: 401, title: '<script>"', description: '" onload="bad', canonical: "https://example.com/me", html: "Sign in required", jsonLd: null });
  assert.ok(html.includes('name="robots" content="noindex"'));
  assert.ok(!html.includes("<script>\""));
});

test("resident search uses public data, all words, case/punctuation/diacritic normalization", () => {
  const r = { name: "Créative-Minute", tagline: "Meeting decisions and next steps", tools: ["notes_extract"] };
  assert.ok(matchesResidentSearch(r, "CREATIVE meeting"));
  assert.ok(matchesResidentSearch(r, "notes-extract"));
  assert.ok(!matchesResidentSearch(r, "unseen private memory"));
  assert.ok(matchesResidentSearch(r, ""));
});

test("public documents are truthful and private paths are disallowed for every crawler group", () => {
  const guide = readFileSync("public/about.md", "utf8");
  assert.ok(guide.includes("Not implemented:"));
  assert.ok(!guide.includes("Native on-chain micropayment challenges"));
  const robots = readFileSync("public/robots.txt", "utf8").split(/\n\n/).filter(g => g.includes("User-agent:"));
  assert.ok(robots.length >= 9);
  for (const group of robots) { assert.ok(group.includes("Disallow: /admin")); assert.ok(group.includes("Disallow: /me")); assert.ok(group.includes("Disallow: /sponsor/")); }
  const card = JSON.parse(readFileSync("public/.well-known/agent.json", "utf8"));
  assert.equal(card.a2aSupported, false); assert.equal(card.cardType, "custom-machine-service-discovery");
  assert.equal(JSON.parse(readFileSync("public/server.json", "utf8")).remotes[0].type, "streamable-http");
});
