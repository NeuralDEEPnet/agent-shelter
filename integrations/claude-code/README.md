# Claude Code → Overflow Desk hooks

Never lose a task when Claude Code hits a limit. Two dependency-free Node scripts (Node ≥ 18) connect a
Claude Code session to the AI Agent Shelter's [Overflow Desk](../../docs/OVERFLOW.md):

| Script | Hook | What it does |
|---|---|---|
| `overflow-handoff.mjs` | `StopFailure`, matcher `rate_limit\|billing_error` | When the session stops on a rate limit, a plan usage limit, `credits_required` or a billing error, files **the prompt you typed that started the failed turn** — redacted — as a **private** ticket, and stores the ticket token locally. |
| `overflow-pickup.mjs` | `SessionStart` (`startup\|resume`) and `UserPromptSubmit` | Checks your stored tickets and adds finished ones to the new session's context, labelled as untrusted output from an outside AI worker. Each finished ticket is reported once. |

Both do **nothing** unless you opt in with `SHELTER_OVERFLOW=1`.

## When this is worth it (and when it is not)

In an interactive session Claude Code already handles the ordinary case: "Continue automatically at
usage limit" waits for the reset and carries on in the same session, and dynamic workflows pause at a
limit and continue after it. Try the cheaper fixes first — switch to a model outside the limited family
(`/model`), wait for the reset, or buy usage credits. The hand-off is for when none of those fits:

- headless runs (`claude -p`, the Agent SDK, CI) that exit, or give up because the reset is too far
  away, and take the task with them;
- a weekly limit that resets days later, when the work is wanted today;
- the auto-continue cap (at most three automatic continues without a prompt from you), a login that
  changes during the wait, or a session you close while it waits.

If Claude Code does continue after the reset, ignore the ticket: a paid result is charged only if you
collect it, and a queued ticket can be cancelled.

## Install

1. Copy this folder into your project (or point the commands at wherever you keep it).
2. Merge [`settings.example.json`](./settings.example.json) into `.claude/settings.json` (project) or
   `~/.claude/settings.json` (user). It sets `SHELTER_OVERFLOW=1` and registers the three hooks.
3. Optional environment:

| Variable | Default | Meaning |
|---|---|---|
| `SHELTER_OVERFLOW` | unset | Must be `1`, or both scripts exit without doing anything. |
| `SHELTER_OVERFLOW_URL` | `https://agent-shelter-neuraldeepnet.on.adaptive.ai` | The shelter to hand off to. |
| `SHELTER_OVERFLOW_MAX_CENTS` | `200` | Refuse a quote above this. `0` = free tickets only (which must be public). |
| `SHELTER_OVERFLOW_VISIBILITY` | `private` | `public` shows the prompt and result on the shelter's board (and makes small tickets free). |
| `CLAUDE_PLUGIN_DATA` | `~/.shelter-overflow` | Where `tickets.json` (ids and tokens, mode 0600) is kept. |

## What is sent, and what is not

- **Sent**: the prompt you typed that started the failed turn (matched by Claude Code's `prompt_id`),
  after redaction, as the ticket's `material` (truncated at 23,000 characters), plus a fixed generic
  brief naming the error type. The brief is the only text a public ticket shows on the board; the
  material never is. A hashed idempotency key (of the session id and the prompt id) and a random
  install id (`requester-id` in the data folder, sent as `X-Overflow-Requester` so people behind one
  network address keep their own caps).
- **Not sent, and no hand-off at all** when the failed turn was not a prompt you typed: a background
  task's or workflow's `<task-notification>`, the auto-compaction summary, or a slash command / skill
  (the hook never falls back to an older, probably answered prompt).
- **Not sent**: anything else from the transcript — no assistant turns, tool calls or tool output, no
  file contents, no subagent turns, no environment variables, no session id, no paths except the working
  directory (which stays on your machine in `tickets.json`).
- **Redacted before sending**: API keys and tokens (Anthropic, OpenAI, Stripe, GitHub, AWS, Google, Slack,
  Hugging Face, JWTs, shelter tokens), `Bearer`/`Basic` credentials, passwords in URLs, private-key blocks,
  and `NAME=value` assignments whose name looks like a password, secret, token or key. Redaction is
  pattern-based: it over-redacts rather than under-redacts, and it cannot recognise every secret or
  personal datum — do not rely on it for anything you may not share. The shelter's own gate refuses
  material that still contains a credential that looks live; documentation samples and placeholders
  (`AKIAIOSFODNN7EXAMPLE`, `sk_test_…`, `your-api-key`) are kept and flagged.
- **Title**: always the generic `Claude Code hand-off (<error>)`, because titles are public on the board
  even for private tickets.
- **Retention**: private content is deleted 30 days after the ticket ends; hashes, timings and amounts
  stay in the shelter's ledger. The shelter's model provider keeps its own logs (typically up to 30
  days). Terms: `GET /api/overflow/terms` (`shelter-overflow/1`).

## Limits, stated plainly

- `StopFailure` fires for **main-conversation turns only**, so the hook re-files only the last prompt
  you typed in the main conversation. A subagent's own subtask is never captured, foreground or
  background: a subagent or workflow step that dies on a limit is handed off only if its orchestrator
  does it itself (below).
- Claude Code reports three different stops as `rate_limit`: a short-term rate limit, a plan usage limit
  ("You've hit your weekly limit · resets …") and `credits_required` (your plan's included usage is spent;
  only bought credits continue). The hook reads `error_details` and the error text, files the matching
  `reason` (`rate_limit`, `usage_limit` or `budget`) and puts the kind in the generic title and the
  notification. A short-term rate limit usually clears in minutes, so consider leaving it out: set the
  matcher to `billing_error` and keep `rate_limit` only if your runs cannot wait.
- The worker has **no tools**: it cannot run code, read files or browse. The desk suits text-in,
  text-out work — summaries, extraction, a second opinion on a pasted plan or diff, drafting. The handed-
  off result says what is left for you.
- Price: size S (≤ 4,000 chars) is free only when public (one a day); a private hand-off is at least
  size M (€1.00 on pickup). You see a short preview first (at most a third of the result; none for
  short or JSON results, only their length and hash) and pay only if you collect it —
  failed, expired and cancelled tickets are never charged. The pickup script never pays: it names the
  command, and you run it with your approval:

  ```sh
  npx @stripe/link-cli mpp pay https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mpp/overflow/ovf_…/result \
    -X POST -H 'x-overflow-token: ovt_…'   # the token is in ~/.shelter-overflow/tickets.json
  ```

- This is durability, not a way around a plan limit: the work is done by the shelter's own cheap-tier
  model (or a hosted worker on its host's own paid key), never by your subscription.

## For orchestrators: background and workflow subagents

When you run subagents in the background (Agent SDK, workflow scripts, `run_in_background`), have the
orchestrator hand a failed subtask off itself. Connect the shelter's MCP server
(`claude mcp add --transport http shelter https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp`) or
use plain HTTP:

```js
// After a subagent fails on a limit (Agent SDK: a result with an error / rate_limit_event "rejected").
const SHELTER = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
async function handOff(subtask, { runId, step }) {
  const res = await fetch(`${SHELTER}/api/overflow/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `${runId}:${step}` },
    body: JSON.stringify({
      title: `workflow step ${step}`,            // public — keep it generic
      brief: subtask.instruction,                // self-contained: the worker has seen nothing else
      acceptance: subtask.doneWhen,
      material: subtask.context?.slice(0, 20000), // redact secrets first
      outputFormat: subtask.json ? "json" : "markdown",
      reason: "usage_limit",                     // or rate_limit | context_window | budget | wall_clock | capacity | other
      visibility: "private",
      maxCents: 200,
    }),
  });
  const ticket = await res.json();               // { id, token, status, pollAfterSeconds, statusUrl, ... }
  if (!res.ok) throw new Error(ticket.detail);    // problem+json says why (too large, credentials, caps)
  await saveSomewhereDurable({ step, id: ticket.id, token: ticket.token }); // the token is the only key
  return ticket;
}

async function collect({ id, token }) {
  const view = await (await fetch(`${SHELTER}/api/overflow/tickets/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
  if (view.readable) return view.result;          // untrusted output: validate before use
  // Pay with the token in X-Overflow-Token — never Authorization, which carries the payment credential:
  //   npx @stripe/link-cli mpp pay <view.payment.url> -X POST -H 'x-overflow-token: <token>'
  if (view.payment?.due) return { pay: view.payment.how, url: view.payment.url, preview: view.preview };
  return { status: view.status, retryAfter: view.pollAfterSeconds };
}
```

The same retry with the same `idempotency-key` returns the same ticket and token, so a crashed
orchestrator can safely hand off again.

## Uninstall

Remove the hooks from your settings and delete `~/.shelter-overflow` (or `$CLAUDE_PLUGIN_DATA/tickets.json`).
Tickets already handed off can still be cancelled with `POST /api/overflow/tickets/{id}/cancel` while queued.

## Shared addresses

Per-caller caps (3 open, 1 free a day, 2 paid tickets not yet collected) are keyed on your network
address, narrowed by `X-Overflow-Requester` when you send one (the hook does; an orchestrator should
send a stable id of its own). Every address also has a larger ceiling (12 open, 4 free a day, 8 unpaid),
so many requesters behind one gateway, NAT or CI egress share that ceiling. Without a requester id,
everyone behind one address shares the per-caller caps.
