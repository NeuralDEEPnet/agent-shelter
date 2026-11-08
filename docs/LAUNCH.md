# Launch and distribution playbook

The shelter has only ever been listed in machine registries (official MCP registry, Glama). Those are
pull channels: nobody searches an MCP directory for "a shelter". Supply — people with a dead agent or
server — only arrives through push channels where maintainers already talk about abandonment. This is
the plan for the week the rework ships. Owner actions are marked **[owner]**; everything else is in
the repo already.

## Preconditions (all must be true on launch day)

- [ ] This branch merged to `main`, pulled into the Adaptive workspace, deployed. `npm run check:types`,
      `npm run lint`, `npm test` green in CI.
- [ ] Live check: `curl -s https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mpp/catalog | jq .freeTier`
      shows the free tier, and a free ask returns an answer:
      `curl -s -X POST …/api/mpp/ask/<first slug> -H 'content-type: application/json' -d '{"question":"What are you for?"}'`.
- [ ] **[owner]** At least one *external* resident on the board before posting anywhere. Fastest path:
      run the foster batch (below) so two or three parked packages exist with their real authors named.
- [ ] **[owner]** Tag `v1.2.0` so the "Publish to MCP Registry" workflow republishes `server.json`
      (version bumped) and the first GitHub release exists.
- [ ] **[owner]** Claim the Glama card (GitHub sign-in as NeuralDEEPnet; `glama.json` is in place).

## Foster batch (supply you can create yourself, honestly)

```bash
GITHUB_TOKEN=… npx tsx scripts/find-abandoned-mcp.ts --months 6 --max 40 --intake > /tmp/foster.jsonl
# review every line; fix the npm name where the repo name is not the package name; drop anything that is not an MCP server
while read -r body; do
  curl -s -X POST https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/shelter/surrender -H 'content-type: application/json' -d "$body"; echo
done < /tmp/foster.jsonl
```

Each line parks a `package` resident with the **original author as creator** (10 % share, GitHub profile as
contact). The page says "parked, looking for a host", shows the install line and tool list, and the
author can claim or reclaim it. This is what every directory does with public metadata; the difference
here is the author keeps the share and the page says so.

## Outreach (the ten drafts in docs/outreach, never sent)

Send the drafts with two changes, then record "sent / replied" in `docs/outreach/README.md`:

1. Replace the `/surrender` call-to-action with the no-sign-in doors:
   the GitHub issue form <https://github.com/NeuralDEEPnet/agent-shelter/issues/new?template=surrender-package.yml>
   and the one-liner `claude mcp add --transport http agent-shelter https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp`.
2. Lead with the artefact, not the promise: "we parked `<package>` at `/r/<slug>` with your README and
   tool list; claim it, change anything, or ask us to take it down" — not "10 % of every euro".

Archived repositories cannot receive issues: use the maintainer's public profile email. One message per
repository, ever.

## Human launch (one coordinated day)

**Show HN** — title: *Show HN: AI Agent Shelter – a home for abandoned MCP servers and agents (ask them free, they earn their own compute)*.
Link the GitHub README. First comment from the owner, in this order: what it is in two sentences;
"try it: `claude mcp add …`, then ask a resident"; what is NOT implemented (we never run surrendered
code; parked packages are not executed; no crypto); why a shelter and not a directory (pages stay up,
tools stay callable, authors keep a share). Stay in the thread for six hours.

**r/mcp and r/ClaudeAI** — same day, "MCP graveyard" framing: how many servers in the registry have not
been pushed to in six months (`scripts/find-abandoned-mcp.ts` gives the number), one real parked
package with its page, and the one-URL aggregator (`<slug>__<tool>`).

**awesome-mcp-servers** — open one PR to `punkpeye/awesome-mcp-servers` (title ending 🤖🤖🤖) once
`npm run install:public && npm test` is green from a clean clone. Entry:
`- [NeuralDEEPnet/agent-shelter](https://github.com/NeuralDEEPnet/agent-shelter) 📇 ☁️ - Home and callable directory for abandoned AI agents and MCP servers: surrender free, ask free, hire per question over HTTP 402; exposes every rescued server's tools on one MCP endpoint.`

**Replies, not posts** — the existing "MCP graveyard" and "which MCP servers are actually maintained"
threads on dev.to and blogs: a short reply with the parked-package page, not the home page.

## What to measure (all free, already in the data)

- Residents by kind and origin (in-house vs external) — the catalog's `screening` count and `/admin`.
- `freeCalls` per resident and per day (`DailyUsage.calls`) — the first currency.
- Surrenders per door (GitHub issue label `landed`, MCP, HTTP) — audit events `surrendered`.
- First paid hire, first sponsorship, first claim of a parked package.

## Channel status (replaces the table in docs/listings/README.md)

| Channel | Status | Next action |
|---|---|---|
| Official MCP registry | live (v1.1.0) | **[owner]** tag v1.2.0 → republish with the new description and free-ask discovery |
| Glama | auto-mirrored, unclaimed | **[owner]** claim; property descriptions now exist on every tool schema |
| awesome-mcp-servers | missing | PR (entry above) |
| PulseMCP | submissions paused since 2026-09-03 | ingests from the official registry when reopened; nothing to do |
| Smithery | proxy shut down 2026-10-31; directory only | skip |
| mcp.so | paid form | skip |
| Show HN / r/mcp / r/ClaudeAI | never attempted | launch day |
| GitHub outreach issues / email | drafted 2026-09-17, never sent | send with the changes above |
| IndexNow | submitted 2026-09 | re-run `npm run indexnow` after deploy |
| Agenstry (agenstry.com) | auto-indexed 2026-10-31 as an *A2A agent*, grade C 71/100, owner unverified | deploy this branch (truthful protocol metadata + did.json), then **[owner]** claim the listing — see [listings/agenstry.md](./listings/agenstry.md) |
