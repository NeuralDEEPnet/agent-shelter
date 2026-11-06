import { test } from "node:test";
import assert from "node:assert/strict";
import { injectFragment, staticDiscovery, outageFragment } from "../vite.prerender-plugin";
import { matchesResidentSearch } from "../src/lib/resident-search";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { A2A_METHOD, DEFAULT_MCP_PROTOCOL, MCP_PROTOCOLS, handleMcp } from "../src/api/machine";
import { DEFAULT_MCP_PROTOCOL as CARD_DEFAULT, DID, MCP_PROTOCOLS as CARD_PROTOCOLS } from "./sync-discovery";

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
  // Private SPA routes (/admin, /me, /sponsor/) are deliberately NOT named: robots.txt is public and
  // listing them would advertise them (scripts/seo-social.test.ts). Every group blocks /api/ instead.
  for (const group of robots) { assert.ok(group.includes("Disallow: /api/")); assert.ok(!/\/admin|\/me\b/.test(group)); }
  const card = JSON.parse(readFileSync("public/.well-known/agent.json", "utf8"));
  assert.equal(card.a2aSupported, false); assert.equal(card.cardType, "custom-machine-service-discovery");
  assert.equal(JSON.parse(readFileSync("public/server.json", "utf8")).remotes[0].type, "streamable-http");
});

test("discovery card declares the MCP revisions the endpoint negotiates and never an A2A protocol version", () => {
  const card = JSON.parse(readFileSync("public/.well-known/agent.json", "utf8"));
  // sync-discovery.ts is the source of truth for the card; machine.ts for the endpoint. They must agree.
  assert.deepEqual([...CARD_PROTOCOLS], [...MCP_PROTOCOLS]); assert.equal(CARD_DEFAULT, DEFAULT_MCP_PROTOCOL);
  const [mcp] = card.supportedInterfaces;
  assert.equal(mcp.protocolVersion, DEFAULT_MCP_PROTOCOL);
  assert.ok(mcp.protocolBinding.startsWith("https://modelcontextprotocol.io/specification/"));
  assert.ok(mcp.url.endsWith("/api/mcp"));
  assert.deepEqual(card.protocols.mcp.versions, [...MCP_PROTOCOLS]);
  assert.equal(card.mcpProtocolVersion, DEFAULT_MCP_PROTOCOL);
  assert.equal(card.a2aSupported, false); assert.equal(card.protocols.a2a.supported, false); assert.equal(card.protocols.a2a.protocolVersion, null);
  assert.equal(card.capabilities.extendedAgentCard, false); assert.ok(!("signatures" in card), "unsigned until a JWKS exists; never fake a signature");
  for (const iface of card.supportedInterfaces) assert.ok(!/^(0\.3|1\.0)$/.test(iface.protocolVersion), `looks like an A2A version: ${iface.protocolVersion}`);
  const wk = JSON.parse(readFileSync("public/.well-known/mcp.json", "utf8"));
  assert.equal(wk.protocolVersion, DEFAULT_MCP_PROTOCOL); assert.deepEqual(wk.protocolVersions, [...MCP_PROTOCOLS]); assert.equal(wk.a2a.supported, false);
});

test("did:web document binds the serving host and names the operator; card and registry manifest point at it", () => {
  const did = JSON.parse(readFileSync("public/.well-known/did.json", "utf8"));
  assert.equal(did.id, DID); assert.equal(did.id, "did:web:agent-shelter-neuraldeepnet.on.adaptive.ai");
  assert.ok(did["@context"].includes("https://www.w3.org/ns/did/v1"));
  assert.ok(did.service.some((s: { type: string; serviceEndpoint: string }) => s.type === "ModelContextProtocol" && s.serviceEndpoint.endsWith("/api/mcp")));
  assert.ok(!("verificationMethod" in did), "no keys are published yet; do not pretend otherwise");
  const card = JSON.parse(readFileSync("public/.well-known/agent.json", "utf8"));
  assert.equal(card.identity.did, DID); assert.ok(card.identity.didDocument.endsWith("/.well-known/did.json"));
  const registry = JSON.parse(readFileSync("public/server.json", "utf8"));
  assert.ok(registry._meta["io.modelcontextprotocol.registry/publisher-provided"].discovery.did_document.endsWith("/.well-known/did.json"));
  assert.ok(readFileSync("public/about.md", "utf8").includes("/.well-known/did.json"));
});

test("A2A JSON-RPC methods are refused with an error that names the protocol actually served", async () => {
  for (const method of ["message/send", "message/stream", "tasks/get", "tasks/cancel", "agent/getAuthenticatedExtendedCard", "SendMessage", "SendStreamingMessage", "GetTask", "CancelTask", "ListTasks", "GetExtendedAgentCard", "CreateTaskPushNotificationConfig"]) {
    assert.ok(A2A_METHOD.test(method), method);
    const out = await handleMcp({ jsonrpc: "2.0", id: 7, method, params: { message: { role: "user", parts: [{ text: "hi" }] } } });
    const error = out?.error as { code: number; message: string; data: { protocol: string; a2a: { supported: boolean; protocolVersion: null }; protocolVersions: string[]; card: string } };
    assert.equal(error.code, -32601); assert.match(error.message, /MCP, not A2A/);
    assert.equal(error.data.protocol, "mcp"); assert.equal(error.data.a2a.supported, false); assert.equal(error.data.a2a.protocolVersion, null);
    assert.deepEqual(error.data.protocolVersions, [...MCP_PROTOCOLS]); assert.ok(error.data.card.endsWith("/.well-known/agent.json"));
    assert.ok(!("result" in (out ?? {})));
  }
  for (const method of ["initialize", "tools/list", "tools/call", "ping", "resources/read", "messages", "task", "agents"]) assert.ok(!A2A_METHOD.test(method), `${method} must stay an MCP method`);
  const unknown = await handleMcp({ jsonrpc: "2.0", id: 8, method: "unknown_method" });
  assert.equal((unknown?.error as { code: number }).code, -32601); assert.ok(!("data" in (unknown?.error as object)));
});
