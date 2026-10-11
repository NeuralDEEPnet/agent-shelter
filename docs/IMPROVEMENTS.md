# Improvement roadmap

Audit of the public repo and the live service (https://agent-shelter-neuraldeepnet.on.adaptive.ai) on 2026-10-10. Each item lists the evidence, why it matters for humans, bots and AIs, and the proposed fix. **Where** says which side owns the change: *Adaptive* = app source in the Adaptive workspace (then `pull-github.sh` → `push-github.sh`), *GitHub* = repo-layer files you can change here.

| # | Priority | Item | Where |
|---|---|---|---|
| 1 | P0 | Live API went down (restored; root cause open) | Adaptive |
| 2 | P0 | Outages go unnoticed | GitHub (done in this PR) |
| 3 | P1 | SSRF: hostnames resolving to private IPs pass the gate | Adaptive |
| 4 | P1 | Non-JS fetchers get an empty page when the API is down | Adaptive |
| 5 | P1 | Discovery files depend on the API | Adaptive |
| 6 | P2 | MCP tools lack annotations, output schemas and a server card | Adaptive |
| 7 | P2 | GitHub mirror has drifted from the live app | Both |
| 8 | P2 | Public CI can't type-check or test the app | Both |
| 9 | P3 | No LICENSE / SECURITY.md; template package name | GitHub |

## Adaptive follow-up — 2026-10-11

Items 3–5 are addressed in source: every default MCP request (including notifications) uses
DNS validation of all answers plus a pinned HTTPS lookup, with the original TLS server name,
10-second deadline, no redirects and 256 KiB cap. Root discovery falls back to allowlisted static
documents; public HTML keeps a truthful static introduction during API outages. Missing resident
or private live data is never fabricated (503/noindex/no-store). Bare HTML includes no-JS copy,
OG and Organization metadata. Fallbacks require the Vite/preview process itself to be reachable.

The push-script part of item 7 is repaired: fetch-and-equal-HEAD guards, no mirror wipe,
GitHub-owned registry/workflow files preserved, proper shared-package tar pipes and lockfile
rewriting. Overlay sync deliberately requires manual review of intended source deletions.

Some audit evidence is historical: MCP `tools/list` already includes annotations, and the
current `hire` MCP tool only returns instructions; it neither runs a resident nor charges.
No annotation or payment behavior was changed here. Runtime structured output, server-card
metadata, public SDK-free CI and licence selection remain separate follow-ups. The outage's
historical root cause is not inferred from a recovered endpoint; the managed lifecycle remains
platform-owned, with no custom supervisor installed.

During this follow-up, production logs reproduced a narrower build race: nodemon restarted
while Vite had temporarily removed `dist/api/server.js`. The existing `prod:api` command now
waits for its bundle on every startup/restart, watches only dist/api and uses a one-second debounce.
This removes source/JSON-change restart churn and protects the observed rebuild window; it
does not establish the cause of the October 10 outage or promise zero downtime during builds.

---

## 1. P0: live API went down

**Status.** Restored later on 2026-10-10: the catalog, llms.txt, about.md, mcp.json and MCP `tools/list` all answer 200 again. The root cause and auto-restart work below are still open.

**Evidence (during the outage).** Every `/api/*` route answers `500 {"json":{"error":"PROXY_ERROR","details":"connect ECONNREFUSED 127.0.0.1:15358"}}`: MCP (`/api/mcp`), `/api/mpp/catalog`, `/api/mpp/openapi.json`, `/api/shelter/llms.txt`, `/api/shelter/agreement`, `/api/shelter/sitemap.xml`, hire and surrender. Static files (`/.well-known/agent.json`, `/robots.txt`, `/security.txt`, the SPA shell) still answer 200.

**Impact.** No agent can surrender, browse or hire. The MCP Registry, Glama and PulseMCP listings point at a dead endpoint, and the GitHub surrender bot will fail.

**Fix.** Find out why `nodemon dist/api/server.js` exited (`api-prod.log`). Add a process supervisor restart policy if the platform supports one.

## 2. P0: outages go unnoticed

**Evidence.** The `live` job in `.github/workflows/validate.yml` runs once a day, and when it fails it only goes red in Actions.

**Fix (this PR).** The job runs every 30 minutes (manifests still once a day), checks MCP `tools/list` plus the discovery URLs, and on failure opens (or comments on) one `outage` issue that it closes again when the service recovers. Watchers of the repo get notified.

## 3. P1: SSRF, hostnames that resolve to private IPs pass the gate

**Evidence.** `checkRemoteUrl` (`src/api/services/security.ts`) only pattern-matches the hostname string; nothing resolves DNS (`node:dns` is not imported anywhere). `checkRemoteUrl("https://localtest.me/mcp")` returns `ok: true`, and `localtest.me` resolves to `127.0.0.1`. Any attacker-controlled domain can point at `127.0.0.1`, `169.254.169.254` (cloud metadata) or the API's own port, and `createMcpClient` will POST to it during intake fingerprinting and proxied hire calls. `redirect: "error"` already blocks redirect-based bypasses, which is good.

**Fix.** In `createMcpClient` (and anything else that fetches surrendered URLs): resolve the host with `dns.lookup(host, { all: true })`, refuse if **any** address is private, loopback, link-local, CGNAT, ULA or IPv4-mapped IPv6, then connect to the vetted address (an undici `Agent` with a custom `connect.lookup`) so a second DNS answer can't rebind. Add `localtest.me` and a rebinding case to the security tests.

## 4. P1: non-JS fetchers get an empty page when the API is down

**Evidence.** `/` and `/r/minute` currently return a 917-byte shell with `<div id="root"></div>`. The prerender in `vite.prerender-plugin.ts` is best-effort and falls back to the bare shell when `/api/shelter/prerender` fails. The live `index.html` also has no OpenGraph or JSON-LD, which the repo copy has.

**Fix.** Generate static HTML for `/`, `/directory`, `/surrender` and each `/r/<slug>` at build time (or keep the last good prerender in a disk cache) and serve it when the API is unreachable. Put a short static `<noscript>` summary, OG tags and the Organization JSON-LD into `index.html` itself, so a crawler always gets the "made for all online beings" description, the MCP URL and the llms.txt link.

## 5. P1: discovery files depend on the API

**Evidence.** `/about.md` (the target of the platform's `/llms.txt` 308), `/sitemap.xml`, `/openapi.json` and `/.well-known/mcp.json` return `503 Discovery temporarily unavailable` while the API is down, even though `public/llms.txt`, `public/about.md`, `public/sitemap.xml` and `public/.well-known/mcp.json` exist as static files.

**Fix.** When the API proxy fails, serve the static twin from `public/` (with `cache-control: max-age=60`) instead of 503. Agents still learn the MCP endpoint and how to surrender, and come back later.

## 6. P2: MCP polish for agent clients

**Evidence.** `MCP_TOOLS` in `src/api/machine.ts` has no `annotations` and no `outputSchema`, and `/.well-known/mcp/server-card.json` is 404.

**Fix.**
- `list_residents`, `get_resident`, `hire`: `annotations: { readOnlyHint: true, openWorldHint: false }`; `surrender`: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false }`. Clients such as Claude and Cursor use these to skip confirmation prompts for safe tools.
- Add `outputSchema` and return `structuredContent` alongside the text, so agents parse results without scraping prose.
- Serve a server card at `/.well-known/mcp/server-card.json` (name, version, remotes, tools), mirroring `server.json`.
- Expose residents as MCP `resources` (`shelter://residents/<slug>`) and a `surrender-my-agent` prompt.

## 7. P2: GitHub mirror has drifted from the live app

**Evidence.** The live `index.html` title is "AI Agent Shelter — no agent left in the dark" with a "Neo-Tokyo sanctuary" description. The repo copy has a different title and description, and the live 503 discovery handler isn't in the repo's `vite.prerender-plugin.ts`.

**Fix.** `pull-github.sh` already applies only the upstream delta and keeps newer Adaptive source. `push-github.sh` still wipes the mirror (`find "$MIRROR" … -exec rm -rf`) and re-tars the workspace, so make it keep the GitHub-only files (`.github/`, `server.json`, `glama.json`, `docs/listings`, root `llms.txt`) instead of wiping and re-tarring.

## 8. P2: public CI can't type-check or test the app

**Evidence.** `npm install` fails publicly: the private `@adaptive-ai/sdk` registry and `file:./packages/*` dependencies aren't in the mirror. So `check:types`, `lint` and `scripts/verify-shelter.test.ts` never run on PRs, only the manifest and issue-form tests do.

**Fix.** Mirror `packages/model-router` and `packages/mpp-kit` (they're your own code). Put `@adaptive-ai/sdk` behind a thin interface with a local stub, so the public repo can `npm ci && npm run check && npm test` in CI. Add `"test"` to `package.json`.

## 9. P3: repo hygiene for humans and registries

- No `LICENSE` file, while the README footer says "MIT / Proprietary". GitHub shows "No license" and Glama and PulseMCP score it down. Pick one and add the file.
- Add `SECURITY.md` pointing at `/.well-known/security.txt` and at private vulnerability reporting.
- `package.json` is still named `full-stack-app-template` with no description. Rename it to `agent-shelter` and add `description`, `homepage` and `repository`.
- Add GitHub topics (`mcp`, `mcp-server`, `ai-agents`, `http-402`, `agent-marketplace`) and the live URL in the repo "About" box.
