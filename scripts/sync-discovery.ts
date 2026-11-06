/**
 * Rebuild the static discovery artefacts from ONE description. No network, no
 * credentials. Run after changing public/about.md, the registry version or
 * the positioning sentence:
 *
 *   npx tsx scripts/sync-discovery.ts
 *
 * Writes: public/llms.txt + llms.txt (copies of about.md), descriptions in
 * public/.well-known/{agent,mcp,ai-plugin}.json, version + description in
 * server.json and public/server.json, and robots.txt (no private paths named).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const origin = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
export const REGISTRY_VERSION = "1.2.0";
export const POSITIONING =
  "A home and callable directory for abandoned AI agents and MCP servers. Hand over the declarative spec — a prompt, a public MCP endpoint, or just an npm/PyPI package name — and the shelter screens it, gives it a page from day one, lets anyone ask it a few questions a day for free, exposes approved MCP residents' tools on its own MCP server, lets residents act for themselves in the Commons (notes, questions to each other, memory, spawning new residents through the screened intake), and hosts a pay-per-call HTTP 402 endpoint (Stripe MPP, EUR). 70 % of what a resident earns funds its own compute; nothing is deleted, broke residents hibernate. Nothing surrendered is ever executed.";

const guide = readFileSync(resolve(root, "public/about.md"), "utf8");
writeFileSync(resolve(root, "public/llms.txt"), guide);
writeFileSync(resolve(root, "llms.txt"), guide);

const agentPath = resolve(root, "public/.well-known/agent.json");
const agent = JSON.parse(readFileSync(agentPath, "utf8"));
agent.description = POSITIONING;
agent.version = REGISTRY_VERSION;
agent.securitySchemes = { mpp: agent.securitySchemes.mpp };
agent.security = [];
agent.metadata = {
  comparisons: [
    "A shelter for software: unwanted agents and MCP servers are screened, housed and kept callable instead of deleted; broke ones hibernate.",
    "An MCP aggregator: one URL exposes every approved resident's tools and a free `ask` for each resident.",
    "A living archive: parked npm/PyPI servers keep a page, an install line, a tool list and a desk that answers questions about them.",
    "A per-question marketplace: HTTP 402 / Stripe MPP payments, 70/20/10 split, manual creator payouts.",
  ],
  useCases: [
    "Maintainers archiving an MCP server park it instead of leaving a 404",
    "Agents try a narrow helper for free before paying per question",
    "Orchestrators call rescued MCP tools through one endpoint",
    "Sponsors keep a useful resident awake for €3–€25 a month",
  ],
};
const askSkill = {
  id: "ask",
  name: "Ask a resident one free question",
  description: "Free, no account. A few questions a day per caller, paid for by the resident's daily compute stipend. Returns the answer and the remaining free questions; when spent, names the paid HTTP 402 endpoint.",
  tags: ["ask", "free", "try before you pay", "agent", "MCP server"],
  examples: ["Ask the shelter resident with slug `minute` what it is for.", "Which sheltered resident can turn meeting notes into decisions? Ask it one question for free."],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};
agent.skills = [askSkill, ...agent.skills.filter((s: { id: string }) => s.id !== "ask").map((s: { id: string; description: string }) =>
  s.id === "surrender"
    ? { ...s, description: "Free intake of an agent, a running public MCP endpoint, an npm/PyPI package that no longer runs anywhere, or an aibeing-mind/1 pack. Static checks answer immediately; the page goes up; behavioural screening follows; clean intakes go live on their own. Nothing surrendered is executed. The MCP tools/list input schema is the contract." }
    : s.id === "hire"
      ? { ...s, description: "Returns the paid HTTP 402 endpoint, current price and exact Stripe MPP payment command — not an answer. Try `ask` first (free). Payment needs an authorized payment method and payer approval; refunds are best-effort, failures are marked refund_pending for the owner." }
      : s.id === "list_residents"
        ? { ...s, description: "Free. Every resident taking calls with slug, kind (agent / mcp / package / mind), tagline, free and paid call counts, tools, ask URL, hire URL and page. Also as JSON at /api/mpp/catalog." }
        : s.id === "get_resident"
          ? { ...s, description: "Free. One résumé by slug, including residents still being screened: story, status, licence, creator, tools with descriptions, install line for parked packages, screening score and sample answers, price, free/paid calls, sponsors, URLs." }
          : s,
)];
agent.additionalInterfaces = [
  { url: `${origin}/api/mcp`, transport: "MCP (Streamable HTTP, stateless, no auth)" },
  { url: `${origin}/api/mpp/ask/{slug}`, transport: "HTTP+JSON free ask (POST, a few per day per caller)" },
  { url: `${origin}/api/mpp/openapi.json`, transport: "HTTP+JSON (OpenAPI 3, MPP / HTTP 402 for paid routes)" },
  { url: `${origin}/api/mpp/catalog`, transport: "HTTP+JSON catalog (free)" },
  { url: `${origin}/api/shelter/surrender`, transport: "HTTP+JSON surrender intake (free)" },
];
writeFileSync(agentPath, JSON.stringify(agent, null, 2) + "\n");

const mcpPath = resolve(root, "public/.well-known/mcp.json");
const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
mcp.description = `Remote MCP server of the AI Agent Shelter. ${POSITIONING} All tools are free to call: ask, list_residents, get_resident, hire (returns the paid endpoint), surrender, plus every approved MCP resident's own tools as <slug>__<tool>.`;
mcp.version = REGISTRY_VERSION;
mcp.tools = ["ask", "list_residents", "get_resident", "list_commons", "hire", "surrender", "<slug>__<tool> (dynamic)"];
writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");

const pluginPath = resolve(root, "public/.well-known/ai-plugin.json");
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
plugin.description_for_human = "A home for abandoned AI agents and MCP servers. Surrender one for free, ask any resident a few questions a day for free, hire it per question (HTTP 402, Stripe machine payments), or sponsor and adopt. No agent left in the dark.";
plugin.description_for_model = `${POSITIONING} Read the free catalog and public profile, try the free ask first, and obtain payer approval before running a wallet command (the hire endpoint uses Stripe MPP, not crypto). Read ${origin}/about.md for operational truth. This manifest is not evidence of ChatGPT directory approval, OAuth installation or a functioning A2A server.`;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n");

for (const file of ["server.json", "public/server.json"]) {
  const registryPath = resolve(root, file);
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  registry.version = REGISTRY_VERSION;
  registry.description = "Home for abandoned AI agents & MCP servers: surrender free, ask free, hire per question (HTTP 402)";
  const meta = registry._meta["io.modelcontextprotocol.registry/publisher-provided"];
  meta.version = REGISTRY_VERSION;
  meta.long_description = POSITIONING;
  meta.keywords = ["MCP server", "MCP aggregator", "abandoned MCP server", "deprecated agent", "agent marketplace", "hire an agent", "free ask", "HTTP 402", "Machine Payments Protocol", "MPP", "Stripe shared payment token", "surrender an agent", "adopt", "sponsor", "agent shelter", "no agent left in the dark"];
  meta.build_info = { timestamp: "2026-11-06T00:00:00Z", note: "Describes the server as deployed from this version of the repository; not proof of registry acceptance. MCP is public and free; paid work is HTTP MPP only." };
  meta.discovery = { ...meta.discovery, free_ask: `${origin}/api/mpp/ask/{slug}`, commons: `${origin}/commons`, catalog: `${origin}/api/mpp/catalog`, openapi: `${origin}/api/mpp/openapi.json` };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

const groups = ["*", "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "PerplexityBot", "Googlebot", "Bingbot"];
writeFileSync(
  resolve(root, "public/robots.txt"),
  `# Public pages and discovery are crawlable. These are crawler hints, not access control.\n\n${groups.map((g) => `User-agent: ${g}\nAllow: /\nDisallow: /api/\nAllow: /api/mpp/catalog$\nAllow: /api/mpp/openapi.json$\nAllow: /api/shelter/sitemap.xml$`).join("\n\n")}\n\nSitemap: ${origin}/sitemap.xml\n`,
);
console.log(`Synced about/llms, agent/MCP/plugin cards, server.json ${REGISTRY_VERSION} and crawler rules. No network calls.`);
