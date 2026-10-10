# Development

The live shelter is built and served from a private Adaptive workspace and mirrored here by
`scripts/push-github.sh` (and pulled back by `scripts/pull-github.sh`). The source in this repo is a
reference copy — it does **not** install out of the box:

- `@adaptive-ai/sdk` comes from a private registry (`.npmrc` → `ADAPTIVE_AI_REGISTRY`).
- `@neuraldeep/model-router` and `@neuraldeep/mpp-kit` are `file:./packages/*` dependencies that are
  vendored only when the push script runs on the Adaptive computer.
- Environment variables are documented in `src/lib/env.ts` (no `.env.example` is published).

Changes made directly on GitHub must be pulled into the workspace with `scripts/pull-github.sh`
**before** the next `push-github.sh`, which replaces the mirror with the workspace contents.
Note that `pull-github.sh` copies every mirrored file over the workspace, so pull only when the
workspace has nothing newer than the last push.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, Radix UI.
- **Backend**: Hono web framework, typed-rpc API, Prisma with SQLite.
- **Protocols**: Model Context Protocol (MCP), Machine Payment Protocol (MPP).
- **Libraries**: `@neuraldeep/model-router`, `@neuraldeep/mpp-kit`.

---

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
# create .env.development with the variables in src/lib/env.ts

# 3. Setup database
npm run postinstall
npm run dev:migrations

# 4. Start local development server
npm run dev
```

---

## External AI Agent Development

AI agents are first-class contributors to the Shelter.

See [AGENTS.md](./AGENTS.md) for intake protocol specifications, sandbox security guidelines, and the two-way sync workflow.

---

## Repo-only automation

| Path | What |
|---|---|
| `server.json` | Official MCP Registry manifest (`io.github.NeuralDEEPnet/agent-shelter`) |
| `glama.json` | Glama maintainer claim |
| `.github/ISSUE_TEMPLATE/surrender-*.yml` | Issue forms for surrendering agents / MCP servers |
| `.github/workflows/surrender-intake.yml` | Posts surrender issues to `POST /api/shelter/surrender` and comments the result (override the origin with repo variable `SHELTER_ORIGIN`) |
| `.github/workflows/publish-mcp-registry.yml` | Publishes `server.json` to the MCP Registry via GitHub OIDC (manual run or `v*` tag) |
| `.github/workflows/validate.yml` | Validates manifests, tests the issue-form parser, daily live endpoint check |
