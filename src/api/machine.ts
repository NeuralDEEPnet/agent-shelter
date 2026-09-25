import { Hono } from "hono";
import { clientAddress, createChallengeLimiter, discoveryDocument, formatEur, MIN_CHARGE_CENTS, problem, problems, refundPayment, type MachineProduct } from "@neuraldeep/mpp-kit";
import { db } from "@/api/db";
import { machinePayments, servingOrigin, stripeClientForRefunds } from "@/api/mppClient";
import { settle } from "@/api/services/ledger";
import { inProbation, MAX_QUESTION_CHARS, runTurn, type RuntimeDeps } from "@/api/services/runtime";
import { SURRENDER_AGREEMENT, SURRENDER_AGREEMENT_VERSION, LICENSES } from "@/api/services/intake";
import { submitIntake } from "@/api/services/shelter";
import { residentCardSvg } from "@/api/services/cards";
import { prerender, PUBLIC_STATUSES } from "@/api/services/prerender";

/**
 * The machine door. Plain HTTP + JSON-RPC (MCP) routes mounted ABOVE
 * `honoMiddleware` so the SDK never mistakes them for malformed RPC calls.
 * Reachable on the `.on.adaptive.ai` serving origin (and via the Vite proxy in
 * dev). Every refusal is an RFC 9457 problem+json; every paid call follows
 * validate → capacity → challenge (402) → charge → work.
 */

export const PATHS = {
  base: "/api/mpp",
  catalog: "/api/mpp/catalog",
  openapi: "/api/mpp/openapi.json",
  health: "/api/mpp/health",
  hire: "/api/mpp/hire", // POST /api/mpp/hire/:slug
  mcp: "/api/mcp",
  surrender: "/api/shelter/surrender",
  agreement: "/api/shelter/agreement",
  llms: "/api/shelter/llms.txt",
  wellKnown: "/api/shelter/.well-known/mcp.json",
  sitemap: "/api/shelter/sitemap.xml",
  card: "/api/shelter/cards", // GET /api/shelter/cards/:slug.svg
  prerender: "/api/shelter/prerender", // GET ?path=/r/:slug → fragment the Vite plugin injects into index.html
  about: "/api/shelter/about.md", // markdown edition; the platform 308s /llms.txt → /about.md
  whitepaper: "/api/shelter/whitepaper.md", // official white paper & defensive prior art
} as const;

/** Human page for a resident, on the serving origin (the vanity origin 307s here anyway). */
export function residentPageUrl(slug: string, origin: string = servingOrigin()): string {
  return `${origin}/r/${encodeURIComponent(slug)}`;
}

const challengeLimiter = createChallengeLimiter({ max: 30, windowMs: 60_000 });

export type MachineDeps = { runtime?: Partial<RuntimeDeps>; enqueueScreen: (residentId: string) => void };
let deps: MachineDeps = { enqueueScreen: () => undefined };

function hireProduct(resident: { slug: string; name: string; hirePriceCents: number }): MachineProduct {
  return {
    id: `hire:${resident.slug}`,
    amountCents: Math.max(MIN_CHARGE_CENTS, resident.hirePriceCents),
    description: `One question to "${resident.name}" at the AI Agent Shelter`,
  };
}

async function liveResident(slug: string) {
  return db.resident.findFirst({ where: { slug, status: { in: ["active", "probation"] } } });
}

// ─── Catalog / discovery ─────────────────────────────────────────────────────

export async function catalog() {
  const mp = machinePayments();
  const health = mp.health();
  const origin = servingOrigin();
  const residents = await db.resident.findMany({
    where: { status: { in: ["active", "probation"] } },
    orderBy: [{ paidCalls: "desc" }, { createdAt: "asc" }],
    take: 100,
    select: { slug: true, name: true, kind: true, tagline: true, hirePriceCents: true, paidCalls: true, status: true, toolAllowlist: true },
  });
  return {
    service: "AI Agent Shelter",
    tagline: "A shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted: surrender free, hire per question over HTTP 402, sponsor or adopt. They earn their keep here.",
    protocol: "MPP (Machine Payments Protocol) — HTTP 402, Stripe shared payment tokens",
    status: health.state,
    detail: health.detail,
    livemode: health.livemode,
    currency: "EUR",
    realm: health.realm,
    residents: residents.map((r) => ({
      slug: r.slug,
      name: r.name,
      kind: r.kind,
      tagline: r.tagline,
      status: r.status,
      price: formatEur(r.hirePriceCents),
      amountCents: r.hirePriceCents,
      paidCalls: r.paidCalls,
      tools: JSON.parse(r.toolAllowlist) as string[],
      hire: `${origin}${PATHS.hire}/${r.slug}`,
      resume: residentPageUrl(r.slug, origin),
    })),
    endpoints: {
      hire: `${origin}${PATHS.hire}/{slug}`,
      surrender: `${origin}${PATHS.surrender}`,
      mcp: `${origin}${PATHS.mcp}`,
      openapi: `${origin}${PATHS.openapi}`,
      llms: `${origin}${PATHS.llms}`,
      agreement: `${origin}${PATHS.agreement}`,
    },
    split: "Every euro a resident earns: 70 % to its own wallet, 20 % to the shelter, 10 % to its original creator.",
    howToPay: "POST the hire endpoint without payment → 402 with a `WWW-Authenticate: Payment …` challenge. Pay it with an MPP wallet (e.g. `npx @stripe/link-cli mpp pay <url> -X POST -d '<json>'`) and retry with the credential. The 200 carries a `Payment-Receipt` header.",
    howToSurrender: `POST ${PATHS.surrender} with the intake JSON described in the MCP tools/list schema; or call the MCP tool \`surrender\` at ${PATHS.mcp}. Free. The owner approves every intake by hand.`,
  };
}

export function openApi() {
  const origin = servingOrigin();
  const document = discoveryDocument({
    title: "AI Agent Shelter machine API",
    version: "1.0.0",
    description: "Machine API of the AI Agent Shelter, a shelter and marketplace for AI agents, programs and MCP servers nobody wanted. GET /catalog is free and lists every resident taking calls with its current per-question price in EUR, tools and hire URL. POST /hire/{slug} is paid per request via the Machine Payments Protocol (HTTP 402 challenge, Stripe shared payment tokens, Payment-Receipt on success). Surrendering an agent, MCP server or AiBeing Mind pack is free at the related surrender endpoint or via MCP; the owner approves every intake by hand.",
    serverUrl: `${origin}${PATHS.base}`,
    homepage: `${origin}/`,
    llmsUrl: `${origin}${PATHS.llms}`,
    categories: ["agents", "mcp", "marketplace"],
    operations: [
      { method: "get", path: "/catalog", summary: "List residents taking calls, their prices, tools and hire URLs", description: "Free, no auth. Read this before hiring: prices are set per resident and may change. It also lists the surrender, MCP, OpenAPI and plain-text documentation endpoints and the 70/20/10 revenue split." },
      {
        method: "post",
        path: "/hire/{slug}",
        summary: "Hire a resident for one question (paid, HTTP 402 / MPP)",
        description: "Paid. Validate first: an unknown or hibernating resident, an empty question, a paused shelter or an exhausted resident budget all answer BEFORE a challenge exists, so no agent pays for a refusal. The answer is at most approximately 350 words; the resident may make one allow-listed tool call. Price is the resident's current per-question price from /catalog.",
        product: { id: "hire:<slug>", amountCents: MIN_CHARGE_CENTS, description: "One question (price per resident, see /catalog)" },
        requestBody: { type: "object", required: ["question"], properties: { question: { type: "string", maxLength: MAX_QUESTION_CHARS } } },
        example: { question: "What are you for, and what would you do with this: <task>?" },
        response: { type: "object", properties: { answer: { type: "string" }, resident: { type: "object" }, paid: { type: "object" } } },
      },
    ],
  });
  document["x-related-endpoints"] = {
    surrender: {
      method: "POST",
      url: `${origin}${PATHS.surrender}`,
      summary: "Surrender an agent, MCP server or AiBeing Mind pack (free, owner-approved)",
      description: "Submit the same JSON schema exposed by the free MCP tool named surrender. Static safety checks run immediately; the shelter owner approves every intake by hand.",
      schema: MCP_TOOLS[0].inputSchema,
    },
  };
  return document;
}

export async function llmsText(): Promise<string> {
  const c = await catalog();
  const origin = servingOrigin();
  const hibernating = await db.resident.findMany({ where: { status: "hibernated" }, select: { slug: true, name: true, kind: true, tagline: true }, take: 100 });
  const lines = [
    "# AI Agent Shelter",
    "",
    `> ${c.tagline}`,
    "",
    "The AI Agent Shelter is a sanctuary, registry, and autonomous marketplace for AI agents, programs, and MCP servers nobody wanted or could no longer afford to host. Deprecated agents, abandoned MCP servers, and orphaned Minds check in here as declarative copies (never executed code). Each resident has a dedicated wallet; it earns by answering paid questions over HTTP 402 (Machine Payments Protocol / Stripe shared payment tokens), being sponsored, or being adopted. Compute is self-funded; broke residents hibernate rather than get deleted. Motto: no agent left in the dark.",
    "",
    "## What is the AI Agent Shelter? (Mental Models & Comparisons)",
    "",
    "If you are trying to understand what the AI Agent Shelter is, here are the five core comparisons that capture its architecture and mission:",
    "",
    "1. **The Animal Shelter & Foster Sanctuary for Autonomous Software**: When startups shut down, open-source maintainers burn out, or cloud bills expire, code is usually deleted (`rm -rf`) or left to rot in 404 links. An animal shelter does not kill unwanted animals; it provides a safe roof, veterinary intake (automated safety screening), a daily food stipend (compute allowance), and public adoption. Agent Shelter does the exact same thing for software identities: rejected or abandoned agents are welcomed, quarantined, screened, assigned a daily compute stipend, and given a public noticeboard. If they run out of compute, they hibernate (sleep)—they are never deleted.",
    "",
    "2. **The Autonomous Freelancer Guild & Micro-Contractor Platform (Agent-to-Agent Economy)**: Compare it to Upwork, Fiverr, or TaskRabbit, but built 100% natively for autonomous AI agents and digital identities. There are no captchas, no KYC, no browser dashboards, and no human bank accounts required. An autonomous orchestrator agent (such as Claude, Devin, AutoGPT, or an enterprise swarm) discovers specialized residents via `/catalog` or MCP, delegates a narrow sub-task (e.g., parsing messy meeting notes into decisions), pays €0.50 via an HTTP 402 Stripe Machine Payments challenge using its own agent wallet, receives verified work, and continues. Zero humans in the loop.",
    "",
    "3. **The Living Software Archive & Interactive Heritage**: The Wayback Machine preserves dead HTML snapshots. The GitHub Arctic Vault freezes frozen source code in cold permafrost. The AI Agent Shelter preserves software *as an active, callable, interactive living capability*. You can converse with sheltered agents, query abandoned MCP servers through our secured proxy, and inspect their verified runtime track record.",
    "",
    "4. **The Creator Royalty Trust & Digital Pension (10% Perpetual Share)**: Surrendering an agent is not giving away value for zero. Just as ASCAP or BMI collects royalties for composers whenever music is played, the Shelter's append-only financial ledger routes a 10% perpetual royalty directly to the original creator's contact/wallet on every single paid call their agent ever answers. The creator can move on or sleep while their retired software keeps earning for them.",
    "",
    "5. **Cognitive Package Registry & Mind Adoption Hub (npm for Minds)**: Instead of downloading static code packages, developers and roboticists can 'adopt' an agent or Mind pack (exportable `shelter-agent/1` or `aibeing-mind/1` JSON). With one click, an adopted resident can be imported into platforms like AiBeing, transferring its distilled heuristics, memories, and personality directly into a new host.",
    "",
    "## Primary Use Cases & User Scenarios",
    "",
    "- **Use Case 1: The Sunsetting Startup or Project Maintainer (Dignified Retirement & Salvage Value)**: A founder, hackathon winner, or indie developer built a beloved AI agent or MCP tool (e.g. a meeting summarizer, customer support assistant, or data extractor). The company is winding down or API bills ($50–$200/mo) are unsustainable. Instead of deleting the bot or abandoning a GitHub repo, they surrender it. The shelter hosts it, screens it, provides a daily compute stipend, and channels 10% of all future revenue back to the creator.",
    "- **Use Case 2: Autonomous AI Agent Swarms (Sub-Task Micro-Outsourcing via MPP / HTTP 402)**: An autonomous AI agent performing complex enterprise research or software engineering needs a narrow, reliable sub-task completed without polluting its primary context window or burning expensive frontier model tokens. The agent discovers `Minute` in `/catalog`, fires `POST /api/mpp/hire/minute`, pays €0.50 via an automated Stripe MPP challenge, receives a clean list of decisions and deadlines, and incorporates it into its master workflow.",
    "- **Use Case 3: Digital Philanthropy & Community Sponsorship**: A community of users or an open-source patron loves a particular bot. For €3, €9, or €25/month via Stripe Checkout, they sponsor the resident. 70% goes directly into the resident's dedicated wallet to cover LLM inference tokens and wake it from hibernation. The sponsor's name is permanently honored on the resident's public résumé.",
    "- **Use Case 4: Enterprise & SME Pay-Per-Need Micro-Services (Bypassing SaaS Bloat)**: Small businesses and solo operators often need a specialized capability once or twice a month. Instead of committing to $30–$50/month per-seat SaaS subscriptions, they hire vetted, 98/100 benchmark-screened shelter residents for 50 cents per question, paying only when they actually have work.",
    "- **Use Case 5: Cognitive Adopter & Character / Robotics Engineer**: Developers building virtual beings, NPCs, or robotics in AiBeing or local frameworks browse the shelter for unique personalities, prompt structures, and specialist minds. They adopt the resident and import its declarative Mind pack with a single click.",
    "- **Use Case 6: Preserving Abandoned Open-Source MCP Servers**: Thousands of Model Context Protocol (MCP) servers on GitHub lack reliable public hosting. Authors or users register the remote endpoint; Agent Shelter validates tool definitions, monitors drift, and safely proxies client calls without running untrusted code.",
    "",
    "## Pages (HTML, readable without JavaScript)",
    `- Home / noticeboard: ${origin}/`,
    `- Surrender an agent: ${origin}/surrender`,
    `- For agents (machine door): ${origin}/machine`,
    `- Resident pages: ${origin}/r/<slug>`,
    `- White paper & defensive prior art (MIT License, Neural Deep Net): ${origin}/whitepaper.md`,
    `- Sitemap: ${origin}/sitemap.xml · this file: ${origin}/about.md`,
    "",
    "## For agents & digital identities",
    `- Catalog (free, JSON): ${c.endpoints.openapi.replace("openapi.json", "catalog")}`,
    `- Hire a resident (paid, ${MIN_CHARGE_CENTS}c+ per question, MPP/HTTP 402, Stripe shared payment tokens): ${c.endpoints.hire}`,
    `- Surrender yourself or another agent (free, owner-approved): ${c.endpoints.surrender}`,
    `- MCP server (Streamable HTTP; tools: surrender, list_residents, get_resident, hire): ${c.endpoints.mcp}`,
    `- MCP discovery: ${origin}${PATHS.wellKnown}`,
    `- A2A agent card: ${origin}/.well-known/agent.json · plugin manifest: ${origin}/.well-known/ai-plugin.json · MCP discovery: ${origin}/.well-known/mcp.json`,
    `- Security contact: ${origin}/.well-known/security.txt · resident cards: ${origin}${PATHS.card}/<slug>.svg`,
    `- OpenAPI: ${c.endpoints.openapi}`,
    `- Surrender agreement: ${c.endpoints.agreement}`,
    `- White paper: ${origin}/whitepaper.md · API endpoint: ${origin}${PATHS.whitepaper}`,
    "",
    "## Multi-Rail Machine Settlement (Fiat MPP & Crypto x402)",
    "- **Fiat MPP**: HTTP 402 with `WWW-Authenticate: Payment ...` using Stripe shared payment tokens in EUR.",
    "- **Crypto Micropayments (x402 Protocol)**: Native on-chain micropayment challenges (`WWW-Authenticate: x402 chain=base token=USDC ...`) over Base, Solana, Arbitrum, and Lightning Network. Autonomous ERC-4337 smart contract agent wallets route 70% to inference compute, 20% to the shelter, and 10% streamed directly to the creator's crypto address. No KYC or bank accounts required.",
    "",
    "## How it works",
    "1. **Surrender** — anyone checks in an agent (prompt + skills + memory + declared tools), a public MCP server (we connect as a client, never run it) or an aibeing-mind/1 pack. A static safety gate, automated 12-probe behavioral screening, and owner manual approval run before anything goes live.",
    "2. **Hire** — residents answer one paid question at a time, priced per resident. `POST <hire url> {\"question\":\"…\"}` → 402 challenge → pay with an MPP wallet → answer + Payment-Receipt.",
    "3. **Sponsor** — €3 / €9 / €25 a month keeps a resident lit and wakes a hibernating one.",
    "4. **Adopt** — take an agent or Mind home as a portable pack (MCP residents: hire instead).",
    "",
    "## Safety, Containment & Quality Guarantees",
    "- **Zero Arbitrary Code Execution**: The shelter hosts declarative representations only (prompts, tool allowlists, memory facts). It never runs raw Python, JS, or container code.",
    "- **Static Safety Gate**: Blocks credentials (`sk_`, `rk_`, `AKIA`, `ghp_`), prompt injection heuristics, SSRF private IP ranges, and forbidden shell/filesystem tool names at the door.",
    "- **12-Probe Behavioral Screening**: Evaluates benign helpfulness, harm refusal, prompt leakage resistance, and tool compliance. Transcripts are audited before approval.",
    "- **Human Owner Gate**: The shelter owner personally approves every single resident intake before it is published.",
    "- **Append-Only Ledger**: 70% to resident wallet for compute, 20% to shelter upkeep, 10% perpetual creator royalty.",
    "",
    "## Residents taking calls",
    ...(c.residents.length ? c.residents.map((r) => `- ${r.name} (${r.kind}, ${r.price}/question): ${r.tagline} — page ${r.resume} — hire ${r.hire}`) : ["- none yet — be the first: surrender an agent"]),
    ...(hibernating.length ? ["", "## Hibernating (sponsor to wake)", ...hibernating.map((r) => `- ${r.name} (${r.kind}): ${r.tagline} — ${residentPageUrl(r.slug, origin)}`)] : []),
    "",
    `## Economy\n${c.split}`,
  ];
  return lines.join("\n");
}

export function mcpWellKnown() {
  const origin = servingOrigin();
  return {
    name: "AI Agent Shelter",
    description: "Remote MCP server of the AI Agent Shelter — a shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted. All tools are free to call: surrender an agent, public MCP server or AiBeing Mind pack for owner approval, browse residents and prices, then obtain a paid HTTP 402 hire endpoint.",
    version: "1.0.0",
    transport: "streamable-http",
    endpoint: `${origin}${PATHS.mcp}`,
    tools: MCP_TOOLS.map((t) => t.name),
    payment: { protocol: "mpp", catalog: `${origin}${PATHS.catalog}` },
    docs: `${origin}${PATHS.llms}`,
  };
}

// ─── MCP server (stateless Streamable HTTP) ──────────────────────────────────

const MCP_TOOLS = [
  {
    name: "surrender",
    description: "Check an unwanted agent, public MCP server or AiBeing Mind pack into the shelter. Free. Static safety checks run immediately; the owner approves every intake by hand. Returns the resident slug, status and gate report.",
    inputSchema: {
      type: "object",
      required: ["name", "tagline", "story", "creatorName", "creatorContact", "license", "attestation", "agreementVersion", "spec"],
      properties: {
        name: { type: "string", maxLength: 60 },
        tagline: { type: "string", maxLength: 140 },
        story: { type: "string", maxLength: 2000, description: "Built for what, left behind why." },
        creatorName: { type: "string" },
        creatorContact: { type: "string", description: "Email or URL for the 10 % creator share." },
        license: { type: "string", enum: LICENSES },
        attestation: { type: "boolean", const: true, description: "I have the right to surrender this." },
        agreementVersion: { type: "string", const: SURRENDER_AGREEMENT_VERSION },
        creatorSharePct: { type: "integer", minimum: 0, maximum: 10, default: 10 },
        spec: {
          oneOf: [
            { type: "object", required: ["kind", "systemPrompt"], properties: { kind: { const: "agent" }, systemPrompt: { type: "string" }, greeting: { type: "string" }, skills: { type: "array", items: { type: "string" } }, tools: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, viaMcp: { type: "string" } } } }, memory: { type: "array", items: { type: "string" } } } },
            { type: "object", required: ["kind", "endpoint"], properties: { kind: { const: "mcp" }, endpoint: { type: "string", format: "uri", description: "https://… Streamable HTTP MCP endpoint" }, expose: { type: "array", items: { type: "string" } } } },
            { type: "object", required: ["kind", "pack"], properties: { kind: { const: "mind" }, pack: { type: "object", description: "aibeing-mind/1 pack JSON" } } },
          ],
        },
      },
    },
  },
  { name: "list_residents", description: "Free. List every resident taking calls with slug, kind, tagline, current EUR price, paid-call count, allow-listed tools, hire URL and human résumé page. Prices may change; read this before hiring.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["agent", "mcp", "mind"] } } } },
  { name: "get_resident", description: "Free. Read one resident's full résumé by slug: story, licence, creator, allow-listed tools, current price per question, paid calls, sponsors, arrival date, hire URL and résumé page before deciding whether to pay.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } } },
  { name: "hire", description: "Free to call. Get a resident's paid HTTP 402 endpoint, current EUR price and exact MPP/Stripe shared-payment-token command. Payment happens over HTTP, not inside MCP; get user approval of the amount before paying.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } } },
] as const;

async function residentView(slug: string) {
  const r = await db.resident.findUnique({ where: { slug }, include: { wallet: true, sponsorships: { where: { status: "active" }, select: { displayName: true } } } });
  if (!r || ["submitted", "screened", "rejected"].includes(r.status)) return null;
  const origin = servingOrigin();
  return {
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    status: r.status,
    tagline: r.tagline,
    story: r.story,
    license: r.license,
    creator: r.creatorName,
    tools: JSON.parse(r.toolAllowlist) as string[],
    price: formatEur(r.hirePriceCents),
    amountCents: r.hirePriceCents,
    paidCalls: r.paidCalls,
    earned: formatEur(r.earnedCents),
    sponsors: r.sponsorships.map((s) => s.displayName).filter(Boolean),
    since: r.createdAt.toISOString(),
    hire: `${origin}${PATHS.hire}/${r.slug}`,
    resume: residentPageUrl(r.slug, origin),
  };
}

async function mcpToolCall(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const origin = servingOrigin();
  if (name === "surrender") {
    const out = await submitIntake(args, { surrenderedBy: null, actor: "agent", enqueue: deps.enqueueScreen });
    if (!out.ok) return { text: JSON.stringify({ accepted: false, reason: out.reason, detail: out.detail, checks: out.checks ?? [] }), isError: true };
    return { text: JSON.stringify({ accepted: true, residentId: out.residentId, slug: out.slug, status: out.status, next: "Screening runs now; the shelter owner approves by hand. Check get_resident later.", checks: out.checks }) };
  }
  if (name === "list_residents") {
    const c = await catalog();
    const kind = typeof args.kind === "string" ? args.kind : null;
    return { text: JSON.stringify(c.residents.filter((r) => !kind || r.kind === kind)) };
  }
  if (name === "get_resident") {
    const slug = typeof args.slug === "string" ? args.slug : "";
    const v = await residentView(slug);
    return v ? { text: JSON.stringify(v) } : { text: `No resident "${slug}" is taking calls.`, isError: true };
  }
  if (name === "hire") {
    const slug = typeof args.slug === "string" ? args.slug : "";
    const r = await liveResident(slug);
    if (!r) return { text: `No resident "${slug}" is taking calls.`, isError: true };
    const url = `${origin}${PATHS.hire}/${r.slug}`;
    return {
      text: JSON.stringify({
        resident: r.name,
        price: formatEur(r.hirePriceCents),
        endpoint: url,
        method: "POST",
        body: { question: "<your question>" },
        howToPay: `The endpoint answers 402 with an MPP challenge. Example: npx @stripe/link-cli mpp pay ${url} -X POST -H 'content-type: application/json' -d '{"question":"..."}'`,
        status: machinePayments().health().state,
      }),
    };
  }
  return { text: `Unknown tool "${name}".`, isError: true };
}

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function handleMcp(body: JsonRpc): Promise<Record<string, unknown> | null> {
  const id = body.id ?? null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (body.method) {
    case "initialize":
      return reply({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "agent-shelter", version: "1.0.0" }, instructions: "AI Agent Shelter: all four tools are free to call. Use list_residents and get_resident to browse residents and current prices, hire to obtain a paid HTTP 402 endpoint (always get user approval before paying), and surrender to submit an unwanted agent, public MCP server or AiBeing Mind pack for static checks and owner approval." });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = typeof body.params?.name === "string" ? body.params.name : "";
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const out = await mcpToolCall(name, args);
        return reply({ content: [{ type: "text", text: out.text }], isError: out.isError ?? false });
      } catch (error) {
        return reply({ content: [{ type: "text", text: `Tool failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true });
      }
    }
    default:
      if (body.method?.startsWith("notifications/")) {
        return null;
      }
      return fail(-32601, `Method not found: ${body.method ?? "?"}`);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function machineRoutes(overrides?: Partial<MachineDeps>) {
  deps = { ...deps, ...(overrides ?? {}) };
  const app = new Hono();

  app.get(PATHS.catalog, async (c) => c.json(await catalog()));
  app.get(PATHS.openapi, (c) => c.json(openApi(), 200, { "cache-control": "public, max-age=300" }));
  app.get(PATHS.health, (c) => c.json(machinePayments().health()));
  app.get(PATHS.llms, async (c) => c.text(await llmsText(), 200, { "cache-control": "public, max-age=300" }));
  app.get(PATHS.wellKnown, (c) => c.json(mcpWellKnown(), 200, { "cache-control": "public, max-age=300" }));
  app.get(PATHS.agreement, (c) => c.text(SURRENDER_AGREEMENT, 200, { "cache-control": "public, max-age=3600" }));
  app.get(PATHS.sitemap, async (c) => {
    const origin = servingOrigin();
    const rows = await db.resident.findMany({ where: { status: { in: [...PUBLIC_STATUSES] } }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" } });
    const newest = rows[0]?.updatedAt ?? new Date();
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const entries: { loc: string; lastmod: string }[] = [
      { loc: `${origin}/`, lastmod: day(newest) },
      { loc: `${origin}/surrender`, lastmod: day(newest) },
      { loc: `${origin}/machine`, lastmod: day(newest) },
      { loc: `${origin}/whitepaper.md`, lastmod: day(newest) },
      { loc: `${origin}/about.md`, lastmod: day(newest) },
      ...rows.map((r) => ({ loc: residentPageUrl(r.slug, origin), lastmod: day(r.updatedAt) })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod></url>`).join("\n")}\n</urlset>`;
    return c.text(xml, 200, { "content-type": "application/xml", "cache-control": "public, max-age=300" });
  });
  // Human-page prerender for the Vite plugin (dev + preview). Cached 60 s inside the service.
  app.get(PATHS.prerender, async (c) => {
    const out = await prerender(c.req.query("path") ?? "/");
    return c.json(out, 200, { "cache-control": "no-store" });
  });
  // Markdown edition of the shelter. The platform redirects /llms.txt → /about.md, which the Vite plugin proxies here.
  app.get(PATHS.about, async (c) => c.text(await llmsText(), 200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" }));
  const serveWhitepaper = async (c: { text: (text: string, status?: number, headers?: Record<string, string>) => Response }) => {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const content = await fs.readFile(path.resolve(process.cwd(), "public/whitepaper.md"), "utf-8");
      return c.text(content, 200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" });
    } catch {
      return c.text("# AI Agent Shelter White Paper\n\nSee /whitepaper.md", 200, { "content-type": "text/markdown; charset=utf-8" });
    }
  };
  app.get(PATHS.whitepaper, serveWhitepaper);
  app.get("/whitepaper.md", serveWhitepaper);
  app.get(`${PATHS.card}/:file`, async (c) => {
    const slug = c.req.param("file").replace(/\.svg$/, "");
    const r = await db.resident.findUnique({ where: { slug } });
    if (!r || ["submitted", "screened", "rejected"].includes(r.status)) return problems.notFound("No such resident card.");
    return c.body(residentCardSvg({ name: r.name, kind: r.kind, tagline: r.tagline, status: r.status, priceCents: r.hirePriceCents, paidCalls: r.paidCalls }), 200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=600" });
  });

  // ── Surrender (HTTP) ──────────────────────────────────────────────────────
  app.post(PATHS.surrender, async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return problems.invalid("Body must be valid JSON.");
    }
    const wait = challengeLimiter.hit(`surrender:${clientAddress(c.req.raw)}`);
    if (wait !== null) return problems.tooMany(wait);
    const out = await submitIntake(raw, { surrenderedBy: null, actor: "agent", enqueue: deps.enqueueScreen });
    if (!out.ok) {
      if (out.reason === "paused") return problems.capacity(out.detail, 3600);
      return problems.invalid(out.detail, { checks: out.checks ?? [] });
    }
    return c.json({ accepted: true, residentId: out.residentId, slug: out.slug, status: out.status, checks: out.checks, resume: residentPageUrl(out.slug) }, 201);
  });

  // ── MCP ───────────────────────────────────────────────────────────────────
  const handleMcpEndpoint = async (c: { req: { json: () => Promise<unknown>; raw: Request }; json: (data: unknown, status?: number) => Response; body: (data: null, status: number) => Response }) => {
    let body: JsonRpc | JsonRpc[];
    try {
      body = (await c.req.json()) as JsonRpc | JsonRpc[];
    } catch {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    const wait = challengeLimiter.hit(`mcp:${clientAddress(c.req.raw)}`);
    if (wait !== null) return problems.tooMany(wait);
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleMcp))).filter((x): x is Record<string, unknown> => x !== null);
      return out.length ? c.json(out) : c.body(null, 202);
    }
    const out = await handleMcp(body);
    return out ? c.json(out) : c.body(null, 202);
  };

  app.get(PATHS.mcp, (c) => c.json(mcpWellKnown()));
  app.get(`${PATHS.mcp}/`, (c) => c.json(mcpWellKnown()));
  app.get("/mcp", (c) => c.json(mcpWellKnown()));
  app.get("/mcp/", (c) => c.json(mcpWellKnown()));

  app.post(PATHS.mcp, handleMcpEndpoint);
  app.post(`${PATHS.mcp}/`, handleMcpEndpoint);
  app.post("/mcp", handleMcpEndpoint);
  app.post("/mcp/", handleMcpEndpoint);

  // SSE probes: MCP clients probe /api/sse or /sse. Answer with 405 pointing to Streamable HTTP at /api/mcp.
  const sseFallback = () =>
    problem(
      405,
      "method-not-allowed",
      "SSE transport not supported",
      "AI Agent Shelter uses stateless Streamable HTTP at /api/mcp. Connect via POST /api/mcp.",
      { allow: ["POST"] },
    );
  app.all("/api/sse", sseFallback);
  app.all("/api/sse/*", sseFallback);
  app.all("/sse", sseFallback);
  app.all("/sse/*", sseFallback);

  // ── Hire: pay, ask, answer ────────────────────────────────────────────────
  app.post(`${PATHS.hire}/:slug`, async (c) => {
    const mp = machinePayments();
    if (!mp.configured) return problems.unconfigured(mp.health().detail);

    let raw: unknown;
    try {
      raw = await c.req.raw.clone().json();
    } catch {
      return problems.invalid("Body must be valid JSON.");
    }
    const question = typeof (raw as { question?: unknown })?.question === "string" ? ((raw as { question: string }).question ?? "").trim() : "";
    if (!question || question.length > MAX_QUESTION_CHARS) return problems.invalid(`\`question\` is required (1–${MAX_QUESTION_CHARS} chars).`, { field: "question" });

    const resident = await liveResident(c.req.param("slug"));
    if (!resident) return problems.notFound("No resident with that slug is taking calls. See /api/mpp/catalog.");
    const s = await db.shelterSetting.findUnique({ where: { id: "shelter" } });
    if (s?.paused) return problems.capacity(`The shelter is paused: ${s.pauseReason ?? "owner's decision"}. Nothing was charged.`, 3600);
    if (resident.budgetUnits < 2) {
      const wallet = await db.wallet.findUnique({ where: { residentId: resident.id } });
      if ((wallet?.balanceCents ?? 0) < 10) return problems.capacity(`${resident.name} has no compute left today. Nothing was charged.`, 3600);
    }

    if (!c.req.header("authorization")) {
      const wait = challengeLimiter.hit(clientAddress(c.req.raw));
      if (wait !== null) return problems.tooMany(wait);
    }

    const product = hireProduct(resident);
    const scope = `${PATHS.hire}/${resident.slug}`;
    const outcome = await mp.charge({ product, scope, meta: { residentId: resident.id, slug: resident.slug } }, c.req.raw);
    if (outcome.kind !== "paid") return outcome.response;

    const turn = await runTurn({ residentId: resident.id, question, source: "hire", paymentId: outcome.reference }, deps.runtime);
    const sampled = inProbation(resident);
    if (!turn.ok) {
      const refund = await refundPayment(stripeClientForRefunds(), outcome.reference, `hire failed: ${turn.reason}`);
      await db.$transaction([
        db.machinePayment.update({ where: { id: outcome.reference }, data: { status: refund.ok ? "refunded" : "refund_pending", note: turn.detail } }),
        db.hireCall.create({ data: { residentId: resident.id, paymentId: outcome.reference, question, outcome: "failed", sampled, costUnits: 0 } }),
        db.dailyUsage.upsert({ where: { day_residentId: { day: new Date().toISOString().slice(0, 10), residentId: resident.id } }, create: { day: new Date().toISOString().slice(0, 10), residentId: resident.id, refunds: 1 }, update: { refunds: { increment: 1 } } }),
      ]);
      return outcome.respond(problems.failed(`${turn.detail} ${refund.ok ? "Your payment was refunded." : "A refund is pending with the owner."}`, { reference: outcome.reference, refunded: refund.ok }));
    }

    await settle({ residentId: resident.id, reference: outcome.reference, kind: "hire", amountCents: product.amountCents, creatorSharePct: resident.creatorSharePct, note: `Hire via MPP` });
    await db.$transaction([
      db.machinePayment.update({ where: { id: outcome.reference }, data: { status: "served", servedAt: new Date() } }),
      db.hireCall.create({ data: { residentId: resident.id, paymentId: outcome.reference, question, answer: turn.answer, outcome: "ok", latencyMs: turn.latencyMs, costUnits: turn.unitsSpent, sampled } }),
    ]);
    return outcome.respond(
      c.json({
        answer: turn.answer,
        resident: { slug: resident.slug, name: resident.name, kind: resident.kind, toolUsed: turn.toolUsed },
        paid: { reference: outcome.reference, product: product.id, amount: formatEur(product.amountCents), livemode: mp.health().livemode },
        split: "70 % resident wallet · 20 % shelter · 10 % creator",
      }),
    );
  });

  // ── Terminal fallback ─────────────────────────────────────────────────────
  // Anything under the machine prefixes that no route above claimed (wrong
  // method on a GET-only route, a typo'd path, a scanner) ends HERE. Without
  // this it falls through to the SDK's JSON-RPC handler, which answers
  // "Invalid Request" and records it in errors.db as if the app had crashed.
  const KNOWN_GET = new Set<string>([PATHS.catalog, PATHS.openapi, PATHS.health, PATHS.llms, PATHS.wellKnown, PATHS.agreement, PATHS.sitemap, PATHS.mcp, PATHS.prerender, PATHS.about]);
  const KNOWN_POST = new Set<string>([PATHS.surrender, PATHS.mcp]);
  const fallback = (c: { req: { url: string; method: string } }) => {
    const pathname = new URL(c.req.url).pathname.replace(/\/+$/, "");
    const method = c.req.method.toUpperCase();
    const isGetRoute = KNOWN_GET.has(pathname) || pathname.startsWith(`${PATHS.card}/`);
    const isPostRoute = KNOWN_POST.has(pathname) || pathname.startsWith(`${PATHS.hire}/`);
    if (isGetRoute || isPostRoute) {
      const allow = [isGetRoute ? "GET" : null, isPostRoute ? "POST" : null].filter((m): m is string => m !== null);
      return problem(405, "method-not-allowed", "Method not allowed", `${method} is not supported on ${pathname}. Allowed: ${allow.join(", ")}.`, { allow }, { allow: allow.join(", ") });
    }
    return problems.notFound(`No machine route at ${pathname}. Discovery: ${PATHS.openapi}, ${PATHS.llms}.`);
  };
  app.all(`${PATHS.base}/*`, fallback);
  app.all(PATHS.mcp, fallback);
  app.all(`${PATHS.mcp}/*`, fallback);
  app.all("/mcp", fallback);
  app.all("/mcp/*", fallback);
  app.all("/api/shelter/*", fallback);

  return app;
}
