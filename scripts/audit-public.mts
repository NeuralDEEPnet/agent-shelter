/** Public read-only audit: no Authorization, intake, wallet payment, Stripe mutation or model call. */
import { writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
const origin = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
const results: Record<string, unknown>[] = [];
async function probe(path: string, body?: unknown, base = origin) {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "user-agent": "Mozilla/5.0 AgentShelterReadOnlyAudit", accept: "application/json,text/html,*/*", ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  const text = await response.text();
  const item: Record<string, unknown> = { path, base, status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type"), bytes: text.length, paymentChallenge: response.headers.has("www-authenticate") };
  try {
    const data = JSON.parse(text); item.json = true;
    if (path.endsWith("health")) { item.paymentState = data.state; item.livemode = data.livemode; item.hasCredentialFields = "key" in data || "profileId" in data; }
    if (path.endsWith("catalog")) item.residents = data.residents?.map((r: { slug: string; price: string; available: boolean }) => ({ slug: r.slug, price: r.price, available: r.available }));
    if (body !== undefined) { item.rpcError = data.error?.code; item.protocolVersion = data.result?.protocolVersion; item.tools = data.result?.tools?.map((t: { name: string }) => t.name); item.toolIsError = data.result?.isError; }
  } catch {
    if (String(item.contentType).includes("text/html")) {
      item.canonicals = [...text.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/g)].map(m => m[1]);
      item.ogTitles = [...text.matchAll(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/g)].map(m => m[1]);
      item.jsonLdCount = [...text.matchAll(/type="application\/ld\+json"/g)].length;
      item.noindex = /name="robots" content="noindex/.test(text);
      item.privateFieldLeak = /budgetUnits|creatorContact|systemPrompt/.test(text);
    }
  }
  results.push(item); console.log(`${body === undefined ? "GET" : "POST"} ${path}: ${response.status}`);
}
await probe("/api/mpp/health");
const paths = ["/", "/r/minute", "/machine", "/surrender", "/admin", "/me", "/api/mcp", "/api/mpp/catalog", "/openapi.json", "/.well-known/mcp.json", "/.well-known/agent.json", "/.well-known/ai-plugin.json", "/.well-known/security.txt", "/security.txt", "/server.json", "/about.md", "/llms.txt", "/sitemap.xml", "/robots.txt", "/unknown-document.json"];
for (let i = 0; i < paths.length; i += 4) await Promise.all(paths.slice(i, i + 4).map(p => probe(p)));
for (const [id, method, params] of [
  [1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "shelter-audit", version: "1" } }],
  [2, "tools/list", {}], [3, "tools/call", { name: "list_residents", arguments: { kind: "agent" } }],
  [4, "tools/call", { name: "get_resident", arguments: { slug: "minute" } }],
  [5, "tools/call", { name: "hire", arguments: { slug: "minute" } }], [6, "unknown_method", {}],
  [7, "tools/call", { name: "get_resident", arguments: { slug: 123 } }],
]) await probe("/api/mcp", { jsonrpc: "2.0", id, method, params });
await probe("/api/mpp/hire/minute", { question: "What are you for?" }); // unpaid 402 only
await probe("/api/mpp/health", undefined, "https://agent-shelter-neuraldeepnet.adaptive.ai");
let customDomain: unknown;
try { customDomain = await lookup("shelter.neuraldeep.net"); await probe("/", undefined, "https://shelter.neuraldeep.net"); }
catch (e) { customDomain = { reachable: false, error: e instanceof Error ? e.message : String(e) }; }
const report = { at: new Date().toISOString(), origin, customDomain, results };
writeFileSync("docs/protocol-seo-live-20261008.json", JSON.stringify(report, null, 2) + "\n");
console.log("Evidence saved to docs/protocol-seo-live-20261008.json; no paid credential or intake sent.");
