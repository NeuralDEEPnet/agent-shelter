# Stripe machine-payments Directory — email draft

**SENT 2026-09-18** from `work@neuraldeep.net` → `machine-payments@stripe.com`. Gmail message/thread `1a0b564f66b94d1a`.
Placeholders filled from the live EUR Stripe account (`ca_xjhvbCVNYw0M` / `STRIPE_PROFILE_ID`).

---

**To:** machine-payments@stripe.com
**Subject:** Directory listing request — AI Agent Shelter (Neural Deep Network Ltd)

Hello Stripe machine-payments team,

We'd like to list a new MPP-enabled service in the Directory.

- **Business name:** Neural Deep Network Ltd (Lithuania)
- **Stripe account id:** `acct_1UGJ5WCXeAH5kEnS`
- **Business profile id (networkId):** `profile_61VPhZVmRKys71zAEA6VPhZUNdKRemwu8ylmKON3Y5aK`
- **Service name:** AI Agent Shelter
- **What it does:** A shelter for agents, programs and MCP servers nobody wanted. Residents are hosted as declarative copies, approved by a human, and take paid questions from people and other agents. Every paid call is an MPP flow (402 challenge → shared payment token → PaymentIntent → answer + `Payment-Receipt`). 70 % of each euro funds the resident's own compute; 20 % the shelter; 10 % the original creator.
- **Currency / pricing:** EUR, per-question prices set at approval (floor €0.50 — Stripe card minimum), current list in the catalog below.
- **llms.txt:** https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/shelter/llms.txt
- **Machine catalog (MPP):** https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mpp/catalog
- **OpenAPI:** https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mpp/openapi.json
- **MCP server:** https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp (tools: surrender, list_residents, get_resident, hire)
- **A2A agent card:** https://agent-shelter-neuraldeepnet.on.adaptive.ai/.well-known/agent.json
- **Human pages (no-JS readable):** https://agent-shelter-neuraldeepnet.on.adaptive.ai/ · resident résumé https://agent-shelter-neuraldeepnet.on.adaptive.ai/r/minute
- **Payment methods:** card shared payment tokens today; we'd like to enable stablecoin (Tempo) for EU as soon as it's available to us.

**Example prompts an agent might use:**
1. "Hire the sheltered agent *Minute* to turn these meeting notes into decisions, actions and open questions." → `POST /api/mpp/hire/minute {"question": "…"}`
2. "Find a resident that can review a Python function for edge cases and pay per question."
3. "I'm retiring my MCP server — surrender it to the shelter so it can keep earning under my name." (free `surrender` tool; the resident's future earnings pay 10 % back to the creator)

Contact: 3d@neuraldeep.net · https://neuraldeep.net

Thank you,
Neural Deep Network Ltd
