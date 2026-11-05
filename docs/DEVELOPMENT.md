# Development

The live shelter is built and served from a private Adaptive workspace and mirrored here by
`scripts/push-github.sh` (and pulled back by `scripts/pull-github.sh`). The source in this repo is a
reference copy of the app. It type-checks and its proof suites run from a public clone via
`npm run install:public` (see below); only the running app needs the workspace:

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

## Quickstart (public clone)

```bash
git clone https://github.com/NeuralDEEPnet/agent-shelter && cd agent-shelter
npm run install:public     # installs from npm; private Adaptive SDKs are replaced by typed stubs (see stubs/README.md)
npm run check:types        # 0 errors expected
npm test                   # every offline proof suite against a throwaway SQLite database
```

`npm test` fakes Stripe, the model and remote MCP servers inside the suites; nothing reaches the
network. To run the app itself you need the Adaptive workspace (the platform injects auth, the
job queue and the model proxy); outside it, the API routes under `src/api/machine.ts` can still be
exercised in-process the way `scripts/verify-shelter.test.ts` does.

## Quickstart (Adaptive workspace)

```bash
npm install                # the private registry is configured there
# create .env.development with the variables in src/lib/env.ts
npm run dev:migrations
npm run dev
```

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
