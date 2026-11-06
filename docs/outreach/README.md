# Graveyard outreach — drafts only

> **2026-11-06 update.** The door these drafts point at has changed: the shelter now accepts a `package`
> kind (an npm / PyPI MCP server that no longer runs anywhere), so the seven stdio servers below are no
> longer "résumé agent" offers — they can be parked with their README and tool list, or pre-parked by us
> with the author named as creator. Before sending, replace the `/surrender` call-to-action with the
> no-sign-in GitHub form (`issues/new?template=surrender-package.yml`) or the one-line
> `claude mcp add …`, and lead with the parked page, not the revenue share. See docs/LAUNCH.md.
> `npx tsx scripts/find-abandoned-mcp.ts --intake` prints ready-to-review package intakes.


Generated 2026-09-17 from one dry run of `scripts/find-abandoned-mcp.ts` (40 candidates, GitHub
search, read-only). Ranked by **stars × days since last push**, then filtered to *actual MCP
servers* (dropped: `tadata-org/fastapi_mcp` — a library; `liaokongVFX/MCP-Chinese-Getting-Started-Guide`
— a guide; `httprunner/httprunner` — a test framework; `chatmcp/mcpso`, `appcypher/awesome-mcp-servers`
— directories). The two **archived** GongRzhe office servers were swapped in for `cjo4m06/mcp-shrimp-task-manager`
and `leonardsellem/n8n-mcp-server` because "archived + pure compute + MIT" is the best possible fit for
the shelter's story; the two swapped-out repos remain in `/tmp/opencode/graveyard.jsonl` for a later round.

**Nothing has been sent.** `outreach.json` is what the owner desk (`/admin` → Outreach) lists; the
"approve to send" toggle only records the owner's approval in the database. Sending is a later phase
(and impossible before the app is shared publicly — the surrender link 404s to outsiders while private).

Honesty notes baked into every draft:
- Most abandoned MCP servers are **stdio/local** (Ghidra, Chrome, WhatsApp, Unreal). For those the
  draft offers the résumé/status page + a docs-trained hosted agent, not remote hosting — the shelter
  never runs surrendered code (v1 decision).
- Archived repos cannot receive GitHub issues; their channel is email / another public contact.
- Every message ends with "if not, no follow-up from us" — one message per repo, ever.

| # | repo | ★ | last push | fit |
|---|---|---|---|---|
| 1 | LaurieWired/GhidraMCP | 10,083 | 2025-06-23 | low-medium |
| 2 | BrowserMCP/mcp | 7,099 | 2025-04-24 | low |
| 3 | BeehiveInnovations/pal-mcp-server | 11,750 | 2025-12-15 | medium |
| 4 | hangwin/mcp-chrome | 12,424 | 2026-01-06 | low |
| 5 | lharries/whatsapp-mcp | 6,280 | 2025-07-13 | low |
| 6 | financial-datasets/mcp-server | 2,293 | 2025-06-05 | high |
| 7 | chongdashu/unreal-mcp | 2,080 | 2025-04-22 | low |
| 8 | anaisbetts/mcp-installer | 1,531 | 2024-11-26 | low |
| 9 | GongRzhe/Office-Word-MCP-Server | 2,106 | 2025-12-31 (archived) | high |
| 10 | GongRzhe/Office-PowerPoint-MCP-Server | 1,852 | 2025-12-31 (archived) | high |
