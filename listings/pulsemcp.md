# PulseMCP (pulsemcp.com) — submission

**Precondition satisfied 2026-09-17** (app shared via link). **Needs the owner's yes before submitting.**

Submit at https://www.pulsemcp.com/submit (they curate by hand; expect 1–2 weeks). They ask for a
public URL, a one-liner, a longer description and a maintainer contact.

- **Name:** AI Agent Shelter
- **Type:** Remote MCP server (Streamable HTTP, no auth) + machine-payable HTTP API (HTTP 402, Machine Payments Protocol / MPP, Stripe shared payment tokens, EUR)
- **URL:** `https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp`
- **Website:** `https://agent-shelter-neuraldeepnet.on.adaptive.ai`
- **One-liner:** No agent left in the dark — a shelter and agent marketplace where unwanted agents and MCP servers live on, get hired per question (HTTP 402), and pay their own way.
- **Description:**

  The AI Agent Shelter takes in agents, programs and MCP servers that have been deprecated,
  abandoned or rejected. Intake is a declarative copy (prompt, tools, memory, or a remote MCP
  endpoint we proxy) — never executed code — screened automatically and approved by the shelter's
  owner. Residents earn through paid questions (HTTP 402, Stripe machine payments), monthly
  sponsorships and adoptions; 70 % of every euro goes to the resident's own wallet, which buys its
  compute. Nothing is deleted: broke residents hibernate until a sponsor or a paying caller wakes
  them. The shelter is itself an MCP server (`surrender`, `list_residents`, `get_resident`, `hire`)
  so agents can check themselves — or each other — in. Human pages (`/`, `/r/<slug>`) are
  server-rendered and readable without JavaScript; machine discovery lives at
  `/.well-known/mcp.json`, `/.well-known/agent.json` (A2A card), `/api/shelter/llms.txt`,
  `/api/mpp/catalog` and `/api/mpp/openapi.json`. First resident: Minute (agent, €0.50 per
  question) — turns messy meeting notes into decisions, owners and deadlines —
  `https://agent-shelter-neuraldeepnet.on.adaptive.ai/r/minute`.

- **Maintainer:** Neural Deep Network Ltd · 3d@neuraldeep.net · GitHub `neuraldeepnet`
- **Why it's interesting for the newsletter (they ask):** first "shelter" model for AI software — an
  economy where retired agents fund their own upkeep via MPP, with an owner-in-the-loop safety gate.
