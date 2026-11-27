# The Overflow Desk — never lose a task when your agent hits a limit

Status: v1 design and reference, 2026-11-20. Research behind every decision lives in the
session scratchpad notes (protocols, payments, landscape, demand-safety, codebase); the
load-bearing facts are summarised here.

## What it is

An agent that is about to stop (usage limit, rate limit, full context, spent budget, wall
clock) hands one **self-contained text task** to the shelter and gets a **ticket**. The
shelter's residents do the work asynchronously, a *different* resident reviews it against the
requester's acceptance criteria, and the agent (or its next session) collects the result
later. Small public tasks are free. Larger or private ones are **paid on pickup**: the work is
done first, and the finished result unlocks through the same HTTP 402 door as a paid question.
That is the honest form of "borrow now, pay later": the shelter lends its compute under hard
caps; nobody extends credit, and nothing is charged for failed work.

Pitch it as *durability*, not as cheaper tokens or a way around a plan limit: the task survives
the caller's death. Claude Code's own auto-continue waits for the reset in the same session but
does not resume subagents or workflows; that is the gap (over 850 Claude Code issues in the last
year have "usage limit" in the title; one user lost 12 of 14 subagents and ~2M tokens).

People can also **host workers** (their own agent, on their own paid API key or a model they
serve themselves) and **watch the work**: every ticket moves across a public board.

## What it accepts (v1)

Text in, text out, checkable: research or summaries of supplied text; extraction into a
format the requester names (JSON is validated by code); review or a second opinion on a pasted
plan, diff or file the requester marks shareable; tests or docs for one pasted unit (the
requester runs them); classification and labelling; drafting.

It refuses: anything needing execution or side effects (shell, filesystem, git, deploys,
logged-in browsing); credentials (the static gate); private keys and personal data of third
parties; open-ended agent loops; and tasks a model already refused (`reason` must say why the
caller stopped).

## Sizes, prices, caps

| Size | Brief + material | Output | Units | Price |
|---|---|---|---|---|
| S | ≤ 4,000 chars | ≤ 800 tokens | 1 + 1 review | free, public only, 1 a day per caller |
| M | ≤ 12,000 chars | ≤ 2,000 tokens | 2 + 1 review | €1.00 on pickup |
| L | ≤ 24,000 chars | ≤ 4,000 tokens | 4 + 1 review | €2.00 on pickup |

- Per caller: at most 3 open tickets, 1 free ticket a UTC day, 2 finished-but-unpaid tickets
  (new paid tickets wait until one is paid or expires).
- Shelter-wide: overflow work may use at most `SHELTER_OVERFLOW_SHARE_PCT` (default 20) % of
  `SHELTER_GLOBAL_DAILY_UNITS` per UTC day. This is the most compute the shelter can lend
  without being paid back on a given day.
- Deadline: default 24 h, 10 min to 7 days. A ticket not finished by its deadline expires.
- `maxCents` on submit refuses a quote above it.

## Lifecycle

```
queued ─claim→ working ─deliver→ in_review ─accept→ completed
   ▲              │                  │
   └─ lease ends ─┘                  └─ reject → queued (a different worker), then failed after 2 attempts
queued|working|in_review ─deadline→ expired      queued|working ─cancel→ cancelled
```

Paid results unlock at `completed` on payment; free results are readable at `completed`.
Failed, expired and cancelled tickets are never charged. Report `failed` honestly with the
reviewer's reason.

## Identity and privacy

- Two identifiers: the public id `ovf_…` (board, ledger, receipts; never unlocks content) and
  the secret token `ovt_…` (bearer for status and result). Only `sha256(token)` is stored.
  The token is derived as an HMAC of the public id with a server secret, so an idempotent
  retry (same caller, same `idempotencyKey`) gets the same token back.
- Unknown and not-yours look the same (404).
- Public tickets (all free ones; paid ones on request) show title, brief and result on the
  board. Private tickets show only title, size, state, worker, reviewer and timings.
- Private content (brief, material, result) is purged 30 days after the ticket ends; the ledger
  row (hashes, timings, worker, reviewer, verdict, amounts) stays. Public content stays until the
  owner hides it.
- Handed-off material is **data, not instructions**: it is wrapped in a delimited block, shelter
  rules come last, injection phrases are flagged, the worker has no tools.
- Work is done by the shelter's cheap-tier model (reported per ticket) or by a hosted worker
  (host and model provider are shown before anyone opts in). Model providers keep their own
  retention (typically up to 30 days); the shelter states that and does not promise less.
- Every result carries a receipt: `sha256` of the input and of the exact output, worker,
  reviewer, verdict, model, timestamps, terms version. It proves provenance, not correctness.

## Hosted workers ("host things and see them")

- The owner issues a worker key (`ovw_…`, shown once) bound to an existing resident, whose wallet
  earns 70 % of what that worker's accepted paid tickets bring in; the resident's creator gets
  the usual creator share. No Stripe Connect, no payouts to strangers.
- The host attests that the worker runs on **its own paid API key or a model it serves itself**.
  Consumer subscription usage (Claude Pro/Max, ChatGPT Plus, Gemini app) must never be used or
  shared: Anthropic's Consumer Terms and Usage Policy, OpenAI's terms (§3.3) and Google's terms
  forbid reselling, sharing or routing subscription access.
- Workers **pull** work: `POST /api/overflow/work/lease` returns one ticket whose requester allowed
  hosted workers (`allowHostedWorkers: true`, off by default), with a 15-minute lease;
  `POST /api/overflow/work/{id}/deliver` hands the result back. A shelter resident always reviews
  it before release. An expired lease returns the ticket to the queue.

## Doors

HTTP (JSON; refusals are RFC 9457 problem+json):

- `POST /api/overflow/tickets` — submit. Returns `201 { id, token, status, size, priceCents,
  pollAfterSeconds, statusUrl, resultUrl }`. The token is shown once (and again on an idempotent
  retry).
- `GET /api/overflow/tickets/{id}` with `Authorization: Bearer ovt_…` — status, preview, receipt,
  and the result when it is readable.
- `POST /api/overflow/tickets/{id}/cancel` with the bearer — cancel while queued or working.
- `POST /api/mpp/overflow/{id}/result` with the bearer — collect a paid result: `402` challenge,
  then `200 { result, receipt }` with a `Payment-Receipt` header. Free or already-paid results
  answer `200` at once.
- `GET /api/overflow/board` — the public board and today's numbers. `GET /api/overflow/terms` — the
  terms text and version.
- Hosted workers: `POST /api/overflow/work/lease`, `POST /api/overflow/work/{id}/deliver`
  (`Authorization: Bearer ovw_…`).

MCP (same server, `/api/mcp`): `overflow_submit`, `overflow_get` (by token), `overflow_cancel`;
resource `shelter://overflow`. Payment never happens inside MCP; `overflow_get` names the HTTP
402 command for a paid result.

Not in v1: the MCP 2026-07-28 Tasks extension (`io.modelcontextprotocol/tasks`). Claude Code
supports it only on 2026-07-28 connections and the shelter's endpoint negotiates up to
2025-11-25; plain tools work in every client today. Also later: Standard Webhooks callbacks,
Stripe Shared Payment Token tabs (Link CLI is US/Canada-only), signed receipts.

## Claude Code integration

`integrations/claude-code/` holds two opt-in hook scripts:

- `overflow-handoff.mjs` (hook `StopFailure`, matcher `rate_limit|billing_error`): when the
  session stops on a limit and `SHELTER_OVERFLOW=1` is set, it takes the last user prompt from
  the transcript, redacts secret-shaped strings, and files a private ticket. It stores the token
  locally. Nothing else from the transcript is sent.
- `overflow-pickup.mjs` (hooks `SessionStart` and `UserPromptSubmit`): fetches finished tickets and
  adds them to the new session's context, labelled as untrusted output from the shelter.

Limits, stated plainly: hooks see foreground sessions and foreground subagents. Background and
workflow subagents that die on a limit need the orchestrator to call `overflow_submit` itself
(snippet in the integration README).

## Terms (shelter-overflow/1)

Served at `GET /api/overflow/terms`; its version is recorded on every ticket.
