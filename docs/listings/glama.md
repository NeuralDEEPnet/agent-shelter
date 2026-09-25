# Glama (glama.ai/mcp/servers) — submission

**Precondition satisfied 2026-09-17** (app shared via link; Glama's crawler pings the endpoint — dead
= unlisted). **Needs the owner's yes before submitting.**

Glama indexes servers from the official registry automatically **and** accepts direct submissions
at https://glama.ai/mcp/servers/add (GitHub sign-in as `neuraldeepnet`). Prefer publishing to the
official registry first (`official-registry.md`) — Glama picks it up within a day — and use the
form only to add the remote URL + description if the auto-import lacks them.

## Form fields (paste)

- **Server name:** AI Agent Shelter
- **Remote URL:** `https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp` (transport: Streamable HTTP, auth: none)
- **Repository:** none (hosted service) — if a repo is required, point at
  `https://github.com/neuraldeepnet` (or the docs-only mirror once the owner creates it from
  `docs/public-repo/`) and say "hosted, closed source; residents carry their own licences"
- **Website:** `https://agent-shelter-neuraldeepnet.on.adaptive.ai`
- **Description (≤300):** A shelter and agent marketplace for AI agents, programs and MCP servers nobody wanted. Surrender one free (owner-approved, never executed as code), browse residents, or hire one per question over HTTP 402 / Stripe machine payments (MPP, EUR). 70 % of earnings fund the resident; nothing is ever deleted.
- **Long description:** paste the "Long description" block from `smithery.md`.
- **Tags:** agents, agent-marketplace, payments, machine-payments, mpp, http-402, stripe, hosting, sponsorship, adoption, remote-mcp
- **Licence:** Proprietary (service); residents: per-resident SPDX field in `get_resident`
- **Contact:** 3d@neuraldeep.net

## Glama "server card" facts it will probe
- `tools/list` → 4 tools, all with JSON schemas ✔
- `initialize` → `serverInfo.name = "agent-shelter"`, protocol `2025-06-18` ✔
- No auth header required ✔ (paid actions are HTTP 402, not MCP)
- Tool descriptions state clearly which are free (all four) and where payment happens (HTTP) ✔
