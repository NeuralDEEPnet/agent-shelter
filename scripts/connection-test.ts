/**
 * Third-party connection test — what an outside client or registry sees.
 *
 * Deliberately imports nothing from src/: it only uses fetch against a public
 * origin, like Agenstry, Glama or a stranger's agent would. It confirms which
 * protocol the published card promises and which one the endpoint actually
 * speaks, and it proves (not assumes) that A2A is NOT served.
 *
 *   npx tsx scripts/connection-test.ts                      # live origin
 *   npx tsx scripts/connection-test.ts http://127.0.0.1:3999 # a local server
 *   npx tsx scripts/connection-test.ts <origin> report.json  # also save the evidence
 *
 * Read-only: no intake, no payment, no model call. Exit code 1 on any FAIL.
 */
import { writeFileSync } from "node:fs";

const origin = (process.argv[2] ?? "https://agent-shelter-neuraldeepnet.on.adaptive.ai").replace(/\/+$/, "");
const reportPath = process.argv[3];
const host = new URL(origin).host;
type Check = { id: string; status: "PASS" | "FAIL" | "WARN" | "INFO"; detail: string; evidence?: unknown };
const checks: Check[] = [];
const add = (id: string, status: Check["status"], detail: string, evidence?: unknown) => { checks.push({ id, status, detail, evidence }); console.log(`${status.padEnd(4)} ${id}: ${detail}`); };

async function get(path: string) {
  const r = await fetch(origin + path, { headers: { accept: "application/json, text/plain, */*", "user-agent": "agent-shelter-connection-test/1 (third-party client simulation)" }, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json: unknown = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, type: r.headers.get("content-type") ?? "", headers: r.headers, text, json: json as Record<string, unknown> | null };
}
async function rpc(url: string, method: string, params: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}, id = 1) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...extraHeaders }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json: Record<string, unknown> | null = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, json };
}

// 1. The discovery card: readable, and honest about which protocol it describes.
const card = await get("/.well-known/agent.json");
const c = card.json ?? {};
if (card.status !== 200 || !card.json) add("card.readable", "FAIL", `GET /.well-known/agent.json → ${card.status} ${card.type}`);
else {
  add("card.readable", "PASS", `200 ${card.type}, ${card.text.length} bytes, version ${String(c.version)}`);
  const required = ["name", "description", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills", "supportedInterfaces"];
  const missing = required.filter((k) => !(k in c));
  add("card.shape", missing.length ? "WARN" : "PASS", missing.length ? `missing A2A-v1.0-shaped fields: ${missing.join(", ")}` : "carries every A2A v1.0 AgentCard field a registry parser looks for (shape only; see card.a2a)");
  const protocols = (c.protocols ?? {}) as Record<string, { supported?: boolean; protocolVersion?: unknown }>;
  const saysNoA2A = c.a2aSupported === false && protocols.a2a?.supported === false;
  add("card.a2a", saysNoA2A ? "PASS" : "FAIL", saysNoA2A ? "card states a2aSupported=false and protocols.a2a.supported=false, protocolVersion null" : `card does not clearly deny A2A (a2aSupported=${String(c.a2aSupported)}, protocols.a2a=${JSON.stringify(protocols.a2a)})`);
  const ifaces = (Array.isArray(c.supportedInterfaces) ? c.supportedInterfaces : []) as Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }>;
  const first = ifaces[0];
  if (!first?.url || !first.protocolVersion || !first.protocolBinding) add("card.protocolVersion", "FAIL", "supportedInterfaces[0] lacks url / protocolBinding / protocolVersion");
  else add("card.protocolVersion", "PASS", `supportedInterfaces[0]: ${first.protocolBinding} ${first.protocolVersion} at ${first.url}`, first);
  const identity = (c.identity ?? {}) as { did?: string; didDocument?: string };
  add("card.identity", identity.did === `did:web:${host}` ? "PASS" : "WARN", identity.did ? `declares ${identity.did}` : "no identity block");
  add("card.signature", Array.isArray(c.signatures) && c.signatures.length ? "PASS" : "INFO", Array.isArray(c.signatures) && c.signatures.length ? "card carries JWS signatures" : "card is unsigned (no JWS, no JWKS published) — self-declared only");
}

// 2. MCP discovery and identity documents.
const mcpWk = await get("/.well-known/mcp.json");
add("mcp.wellKnown", mcpWk.status === 200 && mcpWk.json ? "PASS" : "FAIL", `GET /.well-known/mcp.json → ${mcpWk.status}; protocolVersion ${String(mcpWk.json?.protocolVersion)}`);
const did = await get("/.well-known/did.json");
if (did.status !== 200 || !did.json) add("identity.didWeb", "WARN", `GET /.well-known/did.json → ${did.status} (not deployed yet, or not published)`);
else add("identity.didWeb", did.json.id === `did:web:${host}` ? "PASS" : "FAIL", `id=${String(did.json.id)} (resolver requires did:web:${host})`);
const sec = await get("/.well-known/security.txt");
add("identity.securityTxt", sec.status === 200 && /Contact:/.test(sec.text) ? "PASS" : "WARN", `GET /.well-known/security.txt → ${sec.status}`);
const a2aPath = await get("/.well-known/agent-card.json");
add("a2a.wellKnownPath", a2aPath.status === 404 ? "PASS" : "WARN", a2aPath.status === 404 ? "/.well-known/agent-card.json is 404 — no A2A v1.0 card is published" : `/.well-known/agent-card.json → ${a2aPath.status}: an A2A card path is being served; registries will read it as A2A`);

// 3. The endpoint the card points at: does it speak what the card promises?
const ifaces = (Array.isArray(c.supportedInterfaces) ? c.supportedInterfaces : []) as Array<{ url?: string; protocolVersion?: string }>;
const mcpUrl = ifaces[0]?.url ?? `${origin}/api/mcp`;
const wanted = ifaces[0]?.protocolVersion ?? "2025-06-18";
const init = await rpc(mcpUrl, "initialize", { protocolVersion: wanted, capabilities: {}, clientInfo: { name: "connection-test", version: "1" } });
const negotiated = (init.json?.result as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | undefined);
if (init.status !== 200 || !negotiated?.protocolVersion) add("mcp.initialize", "FAIL", `initialize → HTTP ${init.status}: ${JSON.stringify(init.json).slice(0, 200)}`);
else add("mcp.initialize", negotiated.protocolVersion === wanted ? "PASS" : "WARN", `negotiated MCP ${negotiated.protocolVersion} (card promised ${wanted}); header MCP-Protocol-Version=${init.headers.get("mcp-protocol-version")}; server ${negotiated.serverInfo?.name} ${negotiated.serverInfo?.version}`);
const tools = await rpc(mcpUrl, "tools/list", {}, { "mcp-protocol-version": wanted }, 2);
const names = ((tools.json?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? []).map((t) => t.name);
const core = ["ask", "list_residents", "get_resident", "hire", "surrender"].filter((n) => !names.includes(n));
add("mcp.toolsList", names.length && !core.length ? "PASS" : "FAIL", names.length ? `${names.length} tools${core.length ? `, missing ${core.join(", ")}` : ""}` : `tools/list → HTTP ${tools.status}`);
const list = await rpc(mcpUrl, "tools/call", { name: "list_residents", arguments: {} }, { "mcp-protocol-version": wanted }, 3);
const listResult = list.json?.result as { isError?: boolean; content?: unknown[] } | undefined;
add("mcp.toolsCall", list.status === 200 && listResult && !listResult.isError ? "PASS" : "FAIL", `tools/call list_residents → HTTP ${list.status}${listResult?.isError ? " isError" : ""}`);

// 4. Prove A2A is not served: v0.3 and v1.0 method names, with the A2A-Version header a v1.0 client sends.
let a2aServed = false;
for (const [method, ver] of [["message/send", "0.3"], ["SendMessage", "1.0"], ["tasks/get", "0.3"], ["GetTask", "1.0"]] as const) {
  const r = await rpc(mcpUrl, method, { message: { role: "user", parts: [{ text: "ping" }], messageId: "connection-test" } }, { "A2A-Version": ver }, 9);
  const err = r.json?.error as { code?: number; message?: string; data?: { protocol?: string; a2a?: { supported?: boolean } } } | undefined;
  if (r.json && "result" in r.json) { a2aServed = true; add(`a2a.${method}`, "FAIL", `endpoint RETURNED A RESULT for A2A ${method}: A2A appears to be served, the card is wrong`); continue; }
  const explained = err?.data?.protocol === "mcp" && err.data.a2a?.supported === false;
  add(`a2a.${method}`, err?.code === -32601 ? (explained ? "PASS" : "WARN") : "WARN", err ? `JSON-RPC error ${err.code}${explained ? " with data.protocol=mcp, data.a2a.supported=false (self-explaining)" : " without protocol data — a registry may still count this as a live A2A reply"}` : `HTTP ${r.status} non-JSON-RPC reply`, err);
}
add("a2a.conclusion", a2aServed ? "FAIL" : "PASS", a2aServed ? "A2A methods answered with results" : "every A2A method (v0.3 and v1.0 names) is rejected: this endpoint is MCP only");

const summary = { origin, at: new Date().toISOString(), supportedProtocol: negotiated?.protocolVersion ? `MCP ${negotiated.protocolVersion}` : "unconfirmed", a2a: a2aServed ? "served (unexpected)" : "not supported (confirmed by endpoint)", pass: checks.filter((x) => x.status === "PASS").length, warn: checks.filter((x) => x.status === "WARN").length, fail: checks.filter((x) => x.status === "FAIL").length };
console.log(`\n${JSON.stringify(summary)}`);
if (reportPath) { writeFileSync(reportPath, JSON.stringify({ summary, checks }, null, 2) + "\n"); console.log(`evidence written to ${reportPath}`); }
process.exit(summary.fail ? 1 : 0);
