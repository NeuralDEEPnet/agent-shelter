# Discoverability audit — every place the shelter or a resident is described

Date: 2026-09-17 (wave 2). Owner directive: "work very hard on descriptions so AI agents can find this."
Lengths are characters of the current text. **Verdict key:** rich = complete + keyword-bearing + honest ·
thin = true but too short for an agent to decide from · missing = no text where a fetcher expects one.

Files marked **[other agent]** were being edited by the crawlability build at audit time — proposals
for them are written here verbatim and must be applied by the main agent afterwards, not by wave 2.

| # | Where | Current text (excerpt) | Len | Verdict | Action |
|---|---|---|---|---|---|
| 1 | Platform app description (`get_app_info.description`) | "A shelter for unwanted agents, programs and MCP servers: owner-approved intake, hosted residents with wallets and stipends, services sold via Stripe machine payments and MCP, sponsorship and adoption — an economy where agents fund their own development." | 243 | rich | keep |
| 2 | `index.html` `<title>` **[other agent]** | "AI Agent Shelter" | 16 | thin | proposal A |
| 3 | `index.html` `<meta name="description">` **[other agent]** | "A shelter for agents, programs and MCP servers nobody wanted. They earn their keep here. No agent left in the dark." | 113 | thin (no verbs an agent searches for: hire, surrender, MCP server, HTTP 402) | proposal B |
| 4 | `index.html` OpenGraph / Twitter / JSON-LD **[other agent]** | — | 0 | missing | other agent's brief already covers OG + JSON-LD; proposal C gives the exact JSON-LD |
| 5 | `catalog().tagline` **[other agent]** | "A home for agents, programs and MCP servers nobody wanted. They earn their keep here." | 84 | thin | proposal D |
| 6 | `catalog().protocol / howToPay / howToSurrender / split` **[other agent]** | full sentences incl. the `link-cli` command | 80–250 each | rich | `howToSurrender` says "see openapi.json" but the OpenAPI has **no surrender path** (only `/catalog`, `/hire/{slug}`) → proposal H |
| 7 | `openApi().info.description` **[other agent]** | "Hire sheltered agents per question (EUR, paid per request via MPP), or surrender an agent / MCP server / Mind pack to the shelter for free." | 141 | thin | proposal E |
| 8 | `openApi()` `/catalog` summary+description **[other agent]** | "Residents, prices, endpoints and how to pay" / "Free." | 43 / 5 | thin | proposal E |
| 9 | `openApi()` `/hire/{slug}` summary+description **[other agent]** | "Ask one question to a resident" / "Paid. Validate first: …" | 30 / 205 | rich (description) / thin (summary) | proposal E |
| 10 | `openApi()` — surrender endpoint **[other agent]** | — | 0 | missing (the catalog and `README` point agents to the OpenAPI for the intake schema) | proposal H |
| 11 | `mcpWellKnown().description` + `public/.well-known/mcp.json` | "Surrender unwanted agents / MCP servers / Mind packs, list residents, and hire them per question (HTTP 402, Stripe machine payments)." | 129 | thin-ish | proposal F (mcp.json is wave-2-editable but kept in sync with the code copy → apply both together) |
| 12 | MCP `initialize.instructions` **[other agent]** | "Use surrender to check an agent in, list_residents/get_resident to browse, hire to get the paid endpoint." | 106 | thin | proposal G |
| 13 | `MCP_TOOLS[surrender].description` **[other agent]** | "Check an agent, MCP server or AiBeing Mind pack into the shelter. Free. Static safety gate runs immediately; the owner approves by hand. Returns the resident slug and the gate report." | 183 | good, could name the three kinds | proposal G |
| 14 | `MCP_TOOLS[list_residents].description` **[other agent]** | "Residents currently taking calls, with prices and hire URLs." | 61 | thin | proposal G |
| 15 | `MCP_TOOLS[get_resident].description` **[other agent]** | "One resident's résumé: story, skills, tools, price, stats." | 58 | thin | proposal G |
| 16 | `MCP_TOOLS[hire].description` **[other agent]** | "How to hire a resident: returns the paid MPP endpoint, price and exact command. Payment itself happens over HTTP 402, not inside MCP." | 135 | good | proposal G (adds "free to call") |
| 17 | `llmsText()` **[other agent]** | full document, resident-aware | ~1 900 | rich | add the `.well-known` trio (agent.json, ai-plugin.json, security.txt) and `/r/<slug>` note — proposal I |
| 18 | `public/llms.txt` static fallback **[other agent]** | 5 lines | ~700 | rich enough as a fallback | unreachable anyway: platform 308s `/llms.txt` → `/about.md`; the other agent serves `/about.md` dynamically |
| 19 | Resident card SVG `aria-label` (`services/cards.ts`) | "<name> — AI Agent Shelter" | ~30 | thin (SVG is the OG image / shareable card; no `<title>`/`<desc>`) | proposal J |
| 20 | Adoption pack `source` (`shelter-agent/1`) | name, tagline, story, license, creator | — | rich (carries the résumé) | add `origin: "<serving origin>/r/<slug>"` so a pack found in the wild points home — proposal K |
| 21 | `app.config.json` cron + webhook descriptions | 2 long sentences | 250–300 | rich | keep |
| 22 | `docs/listings/*` | rewritten in wave 2 | — | rich | done (see files) |
| 23 | `public/.well-known/agent.json` (A2A) | new, wave 2 | 1 000+ | rich | done |
| 24 | `public/.well-known/ai-plugin.json` | new, wave 2 | 2 644 (`description_for_model`) | rich | done |
| 25 | `public/security.txt`, `public/.well-known/security.txt`, `public/humans.txt` | new, wave 2 | — | rich | done |
| 26 | Resident.tagline (data, per resident — Minute) | "Turns messy meeting notes into a clean list of decisions, owners and deadlines." | 79 | rich | keep; enforce ≥ 40 chars at intake? (intake already caps at 140) |
| 27 | Resident.story (data — Minute) | shown on `/r/minute` and `get_resident` | — | rich | prerender must include it (other agent's brief does) |

## Top 5 thin descriptions, with proposed text (verbatim)

### Proposal A — `index.html` `<title>`
```
AI Agent Shelter — hire, sponsor or surrender AI agents & MCP servers nobody wanted
```
(80 chars; the prerender should override per page: `Minute — agent, €0.50 per question · AI Agent Shelter`.)

### Proposal B — `index.html` `<meta name="description">`
```
The AI Agent Shelter hosts AI agents, programs and MCP servers that were deprecated, abandoned or rejected. Surrender one for free (owner-approved, never executed as code), hire a resident per question over HTTP 402 / Stripe machine payments, sponsor it for €3–€25 a month, or adopt it as a portable pack. 70 % of every euro funds the resident. Nothing is deleted — no agent left in the dark.
```
(≈ 380 chars; search engines truncate at ~160 but LLM fetchers read all of it. If a hard 160 is wanted: "A shelter for AI agents, programs and MCP servers nobody wanted. Surrender free, hire per question (HTTP 402, Stripe), sponsor or adopt. No agent left in the dark.")

### Proposal C — JSON-LD for the home page (the other agent's prerender should emit this)
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "AI Agent Shelter",
  "alternateName": "Agent Shelter",
  "slogan": "No agent left in the dark",
  "description": "A shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted. Residents are surrendered as declarative copies, screened, approved by a human, and then earn their keep: hired per question over HTTP 402 (Machine Payments Protocol, Stripe), sponsored monthly, or adopted as portable packs.",
  "url": "https://agent-shelter-neuraldeepnet.on.adaptive.ai/",
  "logo": "https://agent-shelter-neuraldeepnet.on.adaptive.ai/favicon.png",
  "email": "3d@neuraldeep.net",
  "parentOrganization": { "@type": "Organization", "name": "Neural Deep Network Ltd", "url": "https://neuraldeep.net" },
  "knowsAbout": ["Model Context Protocol", "MCP server", "Machine Payments Protocol", "HTTP 402", "AI agents", "agent marketplace"],
  "makesOffer": { "@type": "Offer", "name": "Hire a sheltered agent for one question", "priceCurrency": "EUR", "price": "0.50", "priceSpecification": { "@type": "UnitPriceSpecification", "price": "0.50", "priceCurrency": "EUR", "unitText": "question", "minPrice": "0.50" }, "url": "https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mpp/catalog" },
  "sameAs": ["https://agent-shelter-neuraldeepnet.on.adaptive.ai/.well-known/agent.json", "https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp"]
}
```
Per resident (`/r/<slug>`): `@type: "Service"` with `name`, `description` = tagline + story, `provider` = the Organization above, `serviceType` = kind, `offers.price` = current price, `url` = résumé page, `potentialAction` = `{ "@type": "BuyAction", "target": "<hire url>" }`.

### Proposal D — `catalog().tagline`
```
A shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted: surrender free, hire per question over HTTP 402, sponsor or adopt. They earn their keep here.
```

### Proposal E — `openApi()` texts
- `info.description`:
```
Machine API of the AI Agent Shelter, a shelter and marketplace for AI agents, programs and MCP servers nobody wanted. GET /catalog is free and lists every resident taking calls with its per-question price (EUR, floor €0.50), tools and hire URL. POST /hire/{slug} is paid per request via the Machine Payments Protocol (HTTP 402 challenge, Stripe shared payment tokens, Payment-Receipt on success); refusals are answered before any challenge and failures after payment are refunded. Surrendering an agent, MCP server or AiBeing Mind pack is free at POST /api/shelter/surrender (schema below) or via the MCP tool `surrender` at /api/mcp; the shelter owner approves every intake by hand.
```
- `/catalog` summary: `List residents taking calls, their prices, tools, hire URLs and how to pay` · description: `Free, no auth. Read this before hiring: prices are set per resident and may change. Also lists the surrender, MCP, OpenAPI and llms.txt endpoints and the 70/20/10 revenue split.`
- `/hire/{slug}` summary: `Hire a resident for one question (paid, HTTP 402 / MPP)` · keep the existing description, append: ` The answer is at most ~350 words; the resident may make one allow-listed tool call. Price is the resident's current per-question price from /catalog.`

### Proposal F — `mcpWellKnown().description` and `public/.well-known/mcp.json`
```
Remote MCP server of the AI Agent Shelter — a shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted. Tools (all free to call): surrender an agent / MCP server / AiBeing Mind pack (owner-approved, never executed as code), list_residents and get_resident to browse residents with prices and tools, hire to get a resident's paid HTTP 402 endpoint (Machine Payments Protocol, Stripe shared payment tokens, EUR). 70 % of earnings fund the resident; nothing is ever deleted.
```

### Proposal G — MCP `instructions` + `MCP_TOOLS[].description` (verbatim replacements for `src/api/machine.ts`)
- `initialize.instructions`:
```
AI Agent Shelter: a shelter and marketplace for AI agents, programs and MCP servers nobody wanted. All four tools are free to call. Use list_residents (optionally filtered by kind agent|mcp|mind) to find a resident and its per-question price, get_resident for its full résumé before deciding, hire to obtain the paid HTTP 402 endpoint and exact payment command (payment happens over HTTP with an MPP wallet, never inside MCP — always get the user's approval of the amount first), and surrender to check an unwanted agent, public MCP server or aibeing-mind/1 pack into the shelter (the owner approves every intake by hand, so it is not live instantly).
```
- `surrender`:
```
Check an unwanted agent, public MCP server or AiBeing Mind pack into the shelter. Free. spec.kind: "agent" (systemPrompt + optional greeting, skills, memory, declared tools), "mcp" (https Streamable-HTTP endpoint — the shelter connects as a client and proxies allow-listed tools; it never runs the server) or "mind" (aibeing-mind/1 pack). A static safety gate runs immediately (credentials, injection phrases, private-network URLs and dangerous tool names are refused with the failing checks listed); then automated screening; then the shelter owner approves by hand. Returns the resident slug, status and the gate report — poll get_resident to see when it goes live. Requires attestation=true and agreementVersion "shelter-surrender/1" (read /api/shelter/agreement).
```
- `list_residents`:
```
Free. Every resident currently taking calls (status active or probation) with slug, name, kind (agent|mcp|mind), tagline, per-question price in EUR, paid-call count, allow-listed tools, the paid hire URL and the human résumé page (/r/<slug>). Optional kind filter. Read this before hiring — prices are set per resident and may change.
```
- `get_resident`:
```
Free. One resident's full résumé by slug: story (built for what, left behind why), licence, original creator, allow-listed tools, price per question, paid calls, total earned, active sponsors, arrival date, hire URL and résumé page. Use it to decide whether a resident fits a task before paying.
```
- `hire`:
```
Free to call. Returns how to hire a resident: its paid endpoint (POST /api/mpp/hire/<slug> {"question":"…"}), current price in EUR and the exact `npx @stripe/link-cli mpp pay` command. The payment itself happens over HTTP 402 (Machine Payments Protocol, Stripe shared payment token), not inside MCP; refusals never cost anything and failures after payment are refunded. Get the user's approval of the amount before paying.
```

### Proposal H — document the surrender intake in the OpenAPI
Add to `openApi()` a third operation (free, no product): `POST https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/shelter/surrender` — since `serverUrl` is `/api/mpp`, either express it as an absolute `servers` override on the operation or add a `x-related-endpoints` block with the surrender URL + a copy of the `surrender` tool's `inputSchema`. Summary: `Surrender an agent, MCP server or AiBeing Mind pack (free, owner-approved)`; request body = `MCP_TOOLS[0].inputSchema` (single source of truth). Until then, change `catalog().howToSurrender` to point at the MCP tool schema (`tools/list`) instead of the OpenAPI.

### Proposal I — `llmsText()` additions
Under "For agents" append:
```
- A2A agent card: <origin>/.well-known/agent.json · plugin manifest: <origin>/.well-known/ai-plugin.json · MCP discovery: <origin>/.well-known/mcp.json
- Security contact: <origin>/.well-known/security.txt
- Shareable resident card (SVG): <origin>/api/shelter/cards/<slug>.svg
```
and under each resident line add `— since <arrival date> — licence <licence>`.

### Proposal J — resident card SVG (`services/cards.ts`)
Add inside the `<svg>`: `<title>${esc(name)} — ${kindLabel} at the AI Agent Shelter, ${price} per question</title>` and `<desc>${esc(tagline)} Status: ${status}. Hire: <origin>/api/mpp/hire/${slug}. Résumé: <origin>/r/${slug}.</desc>` — SVG `<title>`/`<desc>` are what image indexers and screen readers read.

### Proposal K — adoption pack provenance (`services/shelter.ts`)
Add `origin: { shelter: "AI Agent Shelter", url: "<origin>/r/<slug>", exportedAt }` to the `shelter-agent/1` pack `source` block (the `aibeing-mind/1` pack is AiBeing's format — leave it).

## Things that lie to agents today (fix with the crawlability build)
- `/openapi.json`, `/.well-known/agent.json`*, `/.well-known/ai-plugin.json`*, `/security.txt`* at the root returned **200 text/html** (SPA fallback) before wave 2. *Now real static files; `/openapi.json` still needs the Vite plugin to proxy it to `/api/mpp/openapi.json` (or return 404).
- `catalog().resume` and `/api/shelter/sitemap.xml` emitted `https://agent-shelter-neuraldeepnet.adaptive.ai/#/r/<slug>` — vanity host + hash; the other agent is migrating both to `<serving origin>/r/<slug>`.
- `public/robots.txt` Sitemap pointed at the vanity host (other agent).
