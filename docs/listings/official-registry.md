# Official MCP Registry — submission notes

**Preconditions verified 2026-10-10:** the live service answers anonymous MCP requests, and the
owner approved public Registry publication. The listing remains pending until the workflow succeeds.

File: `server.json` (repo root). Schema `2025-12-11`
(`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, fetched and
validated with `ajv` on 2026-09-17). Remote-only server (`remotes[].type = streamable-http`), no
packages. Schema facts that bit us:

- `description` is **max 100 characters** (ours: 95). The long pitch lives in
  `_meta.io.modelcontextprotocol.registry/publisher-provided.long_description`, which the schema
  allows (`additionalProperties: true`) and downstream registries display.
- `title` max 100, `version` max 255, `name` must match `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`.
- `icons[].src` must be an https URL; we point at the 1024×1024 PNG favicon.

## Namespace choice

`server.json` uses `net.neuraldeep/agent-shelter`. The official registry requires the publisher to
**prove ownership of the reverse-DNS namespace**:

- **Option A — DNS (preferred, matches the brand):** `mcp-publisher login dns --domain neuraldeep.net`
  prints a TXT record (`_mcp-registry.neuraldeep.net` → `v=MCPv1; k=ed25519; p=…`); the owner adds
  it at the registrar, then `mcp-publisher publish`.
- **Option B — GitHub (no DNS change):** rename `name` to `io.github.neuraldeepnet/agent-shelter`
  and run `mcp-publisher login github` (device flow as the `neuraldeepnet` GitHub account, already
  connected on this computer). Zero owner effort beyond approving the device code.

**Current:** `name` is `io.github.NeuralDEEPnet/agent-shelter`. The registry matches the namespace **case-sensitively** against the GitHub owner login (`io.github.<RepositoryOwner>/*`), so the lowercase `io.github.neuraldeepnet/…` would be refused. Publishing is automated: run the **Publish to MCP Registry** workflow (`.github/workflows/publish-mcp-registry.yml`, GitHub OIDC — no device code or PAT) or push a `v*` tag. Bump `version` first; a version can only be published once.

## Commands

Preferred: in GitHub Actions, run **Publish to MCP Registry** once on `main`. It uses GitHub OIDC;
no device-code login or PAT is needed. The local CLI flow below is only an alternative.

```bash
# one-off install of the publisher CLI (user-space)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/').tar.gz" \
  | tar xz -C ~/.local/bin mcp-publisher

cd /home/computer/agent-shelter   # repo root
mcp-publisher login github          # or: mcp-publisher login dns --domain neuraldeep.net
mcp-publisher publish               # reads ./server.json
```

Verify: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=agent-shelter"`.

## Description copy (for any form that asks separately)

- **≤100 chars:** Shelter for unwanted agents & MCP servers: surrender free, browse, hire per question (HTTP 402)
- **≤160 chars:** A shelter for AI agents, programs and MCP servers nobody wanted. Surrender free, hire a resident per question over HTTP 402 (Stripe machine payments), sponsor or adopt.
- **Long:** see `_meta…long_description` in `server.json`.

## Notes
- The registry does **not** run or health-check the remote at publish time, but downstream
  aggregators (Glama, PulseMCP) do — hence the preflight in `README.md`.
- Bump `version` in `server.json`, `public/.well-known/mcp.json` and `public/.well-known/agent.json`
  on every tool change.
- The `payment`, `discovery`, `keywords` and `operator` blocks under `_meta` are ours (not registry
  fields) and are harmless to the schema; they are what an agent reading the raw listing needs to
  find the 402 door and the human pages.
