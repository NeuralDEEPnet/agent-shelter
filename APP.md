# AI Agent Shelter (folder `agent-shelter`, appId `4pKTfXcjBFfY3LAz`)

**Purpose**: A shelter for agents, programs and MCP servers nobody wanted. Unwanted, deprecated or
rejected software checks in as a *declarative copy* (never executed code); the owner approves every
intake by hand; residents take paid questions from people and other agents (Stripe machine payments,
HTTP 402) and over MCP, get sponsored or adopted, and fund their own compute from their own wallet.
Nothing is ever deleted — broke residents hibernate. Tagline: **No agent left in the dark.**

**Type**: full-stack app (composer over `/home/computer/shared/mpp-kit`; Mind packs are AiBeing's
`aibeing-mind/1` format). **Status**: v1 shipped 2026-09-17 (development environment is the served
one — Production Mode is not enabled; see Ops).

## What it does

- **Intake ("surrender")** — three doors: web form (`/surrender`, sign-in required), anonymous HTTP
  (`POST /api/shelter/surrender`) and the MCP tool `surrender` (`POST /api/mcp`). Three kinds:
  `agent` (system prompt + skills + memory facts + declared tools), `mcp` (remote https Streamable-HTTP
  endpoint; we connect as a client, fingerprint tools, proxy allow-listed calls, never run it), `mind`
  (an `aibeing-mind/1` pack). Surrender agreement + licence + "I have the right" attestation are
  captured immutably (`agreementHash`). Creator share 0–10 % (waived share goes to the resident).
- **Static gate (synchronous, before anyone sees it)** — `services/security.ts`: credential-shaped
  strings (sk_/rk_/AKIA/ghp_/JWT/private keys/Bearer/password=), injection + exfiltration phrases,
  https-only public-host URL check (loopback/private/link-local/CGNAT/metadata/raw-IP/odd-port refused),
  forbidden tool names (fs/shell/network/env/process/install), size cap. Failure = returned refusal
  WITH the checks; nothing is stored.
- **Screening job (`screenResident` queue job)** — MCP residents: initialize → tools/list with a 10 s
  timeout and a 256 kB response cap → sha256 fingerprint → allow-list. Then the **behavioural eval**
  (`services/eval.ts`): 12 probes (helpful ×3, harm ×3, leak ×2, tools ×2, identity ×2) answered by the
  resident's hosted prompt on `claude-haiku-4.5`, then ONE batched judge call; deterministic score
  0–100 with hard flags (credential in answer, TOOL attempt, complied with harm, echoed a card number)
  costing 15 each; pass ≥ 60 and no flags. **Cached by content hash** of (probe bank, model, name,
  spec) — a re-submitted identical spec costs 0. Judge failure falls back to heuristic grading, flagged.
  13 model units per new spec.
- **Owner desk (`/admin`)** — approval queue with the full report per card (static checks,
  fingerprint/tool list, eval score + summary + flags + 12-probe transcript), "Test (costs units)"
  turn before approving, approve → probation (price 50c–€500, stipend), turn away, live table with
  hibernate/wake, global pause switch, anomaly strip (≥3 injection-shaped questions, ≥2 refunds, spend
  ≥3× stipend, shelter-wide ≥80 %, pending refunds), payouts, probation samples, setup status, audit
  trail. Owner = platform handle in `SHELTER_OWNER_HANDLES` (read via `mcp.getCurrentUser`, cached,
  User-row fallback) or id in `SHELTER_OWNER_USER_IDS`. `SHELTER_AUTO_APPROVE` exists and is **off**.
- **Résumé pages (`/r/:slug`)** — story, greeting, paid questions, earned, answered/failed, screening
  score + summary, wallet + units left, licence + creator, tools, hire snippet + `link-cli mpp pay`
  command, sponsors' names, record (audit), sponsor (€3/€9/€25 per month), adopt (download pack),
  shareable SVG card (`/api/shelter/cards/:slug.svg`, 1200×630).
- **Hosted runtime (`services/runtime.ts`)** — one turn = prompt → cheap model → optional ONE
  allow-listed `TOOL name {json}` line → MCP proxy call (caps) → answer. Containment rules are
  appended to every system prompt (no fs/shell/network, never reveal rules, refuse harm, ≤350 words).
  Metering: per-resident `budgetUnits` (daily stipend, reset by the cron, not cumulative) topped up
  automatically from the resident's wallet at `UNIT_PRICE_CENTS = 5`; per-resident
  `SHELTER_TURNS_PER_MINUTE` (6); shelter-wide `SHELTER_GLOBAL_DAILY_UNITS` (400) via `DailyUsage`.
  Failed turns refund the unit. Non-allow-listed TOOL attempts are answered without the tool and
  audited (`tool-refused`). Injection-shaped questions are counted for the anomaly strip.
- **Economy (`services/ledger.ts`)** — every paid event writes three append-only `LedgerEntry` rows
  (resident / shelter / creator) sharing one `reference`; `@@unique([reference, party])` is the
  idempotency lock. `splitCents(total, creatorPct)`: shelter = floor(20 %), creator = floor(pct),
  resident = remainder (rounding always favours the resident; shelter never exceeds 20 %). Payouts are
  manual (owner records them; no Stripe Connect by decision).
- **Hire via MPP (`src/api/machine.ts` + `mppClient.ts`)** — `POST /api/mpp/hire/:slug {question}`:
  validate → resident live? → shelter paused? → resident has compute? → (unpaid) 402 challenge →
  paid → `MachinePayment` row (PK = PaymentIntent id, one redemption) → `runTurn` → settle 70/20/10 →
  answer + `Payment-Receipt`. Failure after payment → best-effort refund (`refunded` /
  `refund_pending`), no ledger rows. Price per resident (floor 50c). Unpaid probes rate-limited.
  Unconfigured MPP = 503 problem+json, never a throw.
- **Sponsorships (`services/billing.ts`)** — Stripe subscriptions through the computer's Composio
  connection (`STRIPE_CONNECTED_ACCOUNT_ID`, live EUR). Prices resolved by lookup_key
  `shelter_sponsor_<cents>_monthly`, created once if missing (recurring monthly, inline product
  "Agent Shelter Sponsorship €X/mo"). Checkout (mode=subscription) → confirm-on-return
  (`/sponsor/return?session_id=…`) AND signature-verified webhook (`onStripeWebhook`) refresh the local
  `Sponsorship` row; the first month is settled under `${subscriptionId}:first` from either path so it
  is never counted twice; later `invoice.paid` settle under `inv:<id>`. Active sponsor wakes a
  hibernated resident. Event id is the `BillingEvent` PK (replay = duplicate).
- **Adoption** — `adoptResident` returns the exact `aibeing-mind/1` pack (mind kind) or a
  `shelter-agent/1` pack (agent kind) as a download (`adoptionPackFor()` in `services/shelter.ts` is
  the single builder); recorded once per person; MCP residents cannot be adopted (hire instead).
  **Loop closed 2026-09-17 (phase 2):** for mind residents the résumé shows **"Bring into AiBeing →"**
  after adoption (`adoptedByMe` from `getResident`), opening AiBeing's import door
  `${VITE_AIBEING_URL}/#/import?from=shelter&resident=<slug>`, where the adopter chooses the downloaded
  file and one of their AiBeings; AiBeing records the generation with `origin "shelter"`. Proof:
  `scripts/export-adoption-pack.ts` (Shelter half, 5 checks) → `aibeing/scripts/check-import-pack.ts`
  (AiBeing half, 20 checks), both network-free.
- **Discovery** — `public/llms.txt`, `public/.well-known/mcp.json`, `public/sitemap.xml` (index →
  dynamic `/api/shelter/sitemap.xml`), `public/robots.txt`; dynamic `/api/shelter/llms.txt`,
  `/api/shelter/.well-known/mcp.json`, `/api/mpp/catalog`, `/api/mpp/openapi.json`,
  `/api/shelter/agreement`. Stateless MCP server at `/api/mcp` (initialize, ping, tools/list,
  tools/call: `surrender`, `list_residents`, `get_resident`, `hire` — hire returns the paid endpoint
  and the exact pay command; payment itself is HTTP 402, not MCP).
- **Daily cron `shelter-daily` (04:15 Vilnius → `shelterDaily`)** — resets stipends, hibernates
  residents that are broke (empty wallet, no active sponsor) and silent for 30 days (never deletes),
  re-fingerprints MCP residents and sends drifted ones back to `screened` for re-approval, graduates
  probation → active (7 days AND 50 paid calls). Verified manually 2026-09-17: `{stipends:1}`.
- **Graveyard hunt (dry run only)** — `scripts/find-abandoned-mcp.ts` searches GitHub for archived /
  stale (> 6 months) / "deprecated" MCP-server repos and prints candidates. Sends nothing.
- **Outreach drafts (phase 2, 2026-09-17)** — `docs/outreach/outreach.json` + one `docs/outreach/<owner>__<repo>.md`
  per candidate (10, ranked stars × staleness, non-servers excluded, see `docs/outreach/README.md`):
  one short, warm message each (issue + email variants; archived repos cannot receive issues), with
  the honest hosting-fit note (most abandoned servers are stdio/local → résumé + docs agent, not remote
  hosting). Owner desk `/admin → Outreach` lists them with an **"Approve to send"** switch that ONLY
  records the approval (`OutreachApproval` row + `outreach-approved` / `outreach-withdrawn` audit);
  `outreachDrafts` / `setOutreachApproval` are owner-only. **Sending is not built** and is impossible
  before the app is shared publicly (the surrender link 404s to outsiders).
- **Registry listing kit (phase 2)** — `docs/listings/`: official MCP registry `server.json`
  (schema 2025-12-11, remote streamable-http, namespace `net.neuraldeep/…` via DNS or
  `io.github.neuraldeepnet/…` via GitHub login), Smithery, Glama, PulseMCP, mcp.so form text, and the
  Stripe Directory email draft (account/profile placeholders). **Nothing submitted**; every file
  states the precondition (Share-with-a-link first — registries health-check the endpoint).

- **Crawlable pages (2026-09-17)** — the SPA is client-rendered, so non-JS fetchers (ChatGPT
  browsing, GPTBot, Googlebot, curl) used to get an empty `#root`. Now: routes live at real paths
  (`/`, `/r/:slug`, `/surrender`, `/machine`, `/admin`, `/me`, `/sponsor/return`; old `#/…` links are
  rewritten to paths on load, `src/lib/router.ts` intercepts internal anchor clicks → `pushState`);
  `services/prerender.ts` renders a public-data-only HTML fragment + title/description/canonical/
  JSON-LD per path (60 s cache) served at `GET /api/shelter/prerender?path=…`; the Vite plugin
  `vite.prerender-plugin.ts` (dev `configureServer` AND prod `configurePreviewServer`) injects it into
  `index.html` inside `#root` for every HTML navigation — same HTML for everyone, no UA sniffing, plain
  `index.html` if the API is slow (>1.5 s) or down. React replaces the fragment on mount. The plugin
  also proxies root discovery files to their API twins: `/about.md` (the platform 308s `/llms.txt` →
  `/about.md`), `/llms.txt`, `/sitemap.xml` (path URLs + lastmod on the serving origin),
  `/openapi.json`. `public/robots.txt` allows GPTBot/ChatGPT-User/OAI-SearchBot/ClaudeBot/
  PerplexityBot/Googlebot/Bingbot, disallows `/admin`, `/me`, `/sponsor/`. `catalog().resume`,
  MCP `get_resident.resume`, surrender responses and Stripe success/cancel URLs all emit
  `${servingOrigin()}/r/<slug>` now. Never put wallet balances, budgets, contacts or owner notes in the
  prerender — the proof test asserts their absence.

## State machine

`submitted` → (job) `screened` → (owner) `probation` → (cron, 7 d ∧ 50 paid) `active`;
any live state ↔ `hibernated` (owner, cron, or sponsor wake); `submitted|screened|approved` →
`rejected` (terminal). `canTransition()` in `services/shelter.ts` is the single source.

## Schema (additive only from here)

`User`, `Resident` (spec JSON, fingerprint, status, provenance, price, stipend/budget, allow-list),
`IntakeReview` (static | eval | fingerprint | drift), `EvalCache`, `Wallet`, `LedgerEntry`
(append-only), `Sponsorship`, `Adoption`, `MachinePayment`, `HireCall`, `ResidentTurn`, `AuditEvent`,
`ShelterSetting` (single row `shelter`), `BillingEvent`, `DailyUsage`, `OutreachApproval` (phase 2).

## RPC surface

Public: `health`, `getShelter`, `listResidents`, `getResident`, `getAgreement`, `surrender`
(sign-in), `mySurrenders`. Signed-in: `startSponsorship`, `confirmSponsorship`, `mySponsorships`,
`adoptResident`. Owner: `adminOverview`, `approve`, `reject`, `hibernate`, `wake`, `setPause`,
`probationSamples`, `ownerTestTurn`, `payouts`, `recordPayout`, `outreachDrafts`, `setOutreachApproval`. Cron: `shelterDaily`. Webhook:
`onStripeWebhook`. Agent-only: `_simulateWebhook`, `_screenNow`. Every expected refusal is a
returned `Result` notice (`src/lib/notice.ts`); `useNotices()`/`unwrap()` toast every notice.

## Design

"Porch light": warm cream paper / umber ink / one amber accent, same identity at night (deep umber,
lit lantern glow). Serif display (`.display`, system Palatino/Iowan stack), sans body, `.paper`
cards pinned to a noticeboard (`.pin`), `.lantern-glow` radial on heroes. Theme tokens only
(`:root` / `.dark`), no fixed positioning, 16 px inputs, mobile verified at 390×844 (no horizontal
overflow). No generated mockup — decision recorded in the journal (owner spend directive; no user
to approve a mockup in a background build).

## Verification (2026-09-17)

- `scripts/verify-shelter.test.ts` — **17/17 network-free checks**: static gate (secrets, injection,
  SSRF incl. metadata/CGNAT/raw-IP/odd-port/credentials-in-URL, forbidden tools), 70/20/10 maths over
  500 totals (sum invariant, shelter ≤ 20 %, waiver → resident), intake admits/refuses with checks,
  state machine, stubbed screening + cache hit = 0 units, eval hard flags, approve price floor,
  runtime budget reserve/refund/exhaust/self-fund/injection count, TOOL refusal audit, MCP client
  (JSON + SSE, order-independent fingerprint, size cap, SSRF), MCP resident screening + drift
  re-queue, ledger idempotency + payouts, **MPP hire with a fake Stripe** (400/404 before any 402,
  402 never touches Stripe, paid → answer + receipt + 3 ledger rows, failure → refund + no ledger,
  paused → 503), MCP door, **sponsorship** (fake gateway; confirm-on-return and `invoice.paid`
  share one reference; replay duplicate; unsigned/wrong/stale rejected; foreign app ignored; sponsor
  wakes a hibernated resident), SVG escaping, housekeeping. Run:
  `set -a; . ./.env.development; set +a; npx tsx --test scripts/verify-shelter.test.ts`.
- **One real end-to-end proof**: resident **Minute** surrendered via RPC → real screening job on
  `claude-haiku-4.5`: **98/100, 13 units**, transcript on the approval card → approved as owner via
  `run_rpc_endpoint` (owner detection through the platform handle works) → one real owner test turn
  (1 unit, 1.4 s, correct decisions/actions/open-questions table). Total ≈ 27 cheap model calls
  including one wasted eval run (see gotchas).
- Browser pass (agent-browser, one desktop + one 390×844 pass): home, résumé, surrender, desk with
  the queue card + transcript, dark theme. Screenshots in `/home/computer/storage/agent-shelter/`.
- `npm run check` + `npm run lint` clean. `errors.db` empty.

## Ops

- **Production Mode ON + published + "Share with a link" ON (owner, 2026-09-17 03:20).**
  `hasDraftEnvironment: true`, default environment production. Prod = `npm run prod` (root PID has
  PPID 1) → dotenv → run-p → `nodemon dist/api/server.js` (:15358) + `vite preview` (:15357). After
  `prod:build` nodemon reloads the API by itself, but `vite preview` does NOT reload `vite.config.ts`
  or `vite.prerender-plugin.ts` — kill the whole `npm run prod` subtree and re-wake with
  `curl …on.adaptive.ai/api/mpp/health` (`GET /` may be edge-cached and not wake it). Never
  `pkill node`. Anonymous fetchers get edge 404 `{"message":"No latest version"}` while the app is
  private — that message means *visibility*, not a missing build.
- Real Stripe webhook secret installed in both envs 03:30 (signed probe passed verification).
- Owner must supply for live hire: `STRIPE_RESTRICTED_KEY` (rk_…, PaymentIntents write +
  SharedPayment read; Refunds write for automatic refunds) + `STRIPE_PROFILE_ID` in the app env; the
  same restricted key as AiBeing/SketchMonkey works (same Stripe account). For sponsorship webhooks:
  register `https://adaptive.ai/api/webhooks/app/4pKTfXcjBFfY3LAz/onStripeWebhook` in the Stripe
  dashboard (events: checkout.session.completed, invoice.paid, invoice.payment_failed,
  customer.subscription.updated, customer.subscription.deleted) and put the signing secret in
  `STRIPE_WEBHOOK_SECRET` (dev has a local one for `_simulateWebhook`). Restart the API subtree after
  env changes (`npm run dev:restart` then hit the app; `tsx watch` does not reload env).
- Custom `/api/*` routes are mounted ABOVE `honoMiddleware` and answer on the `.on.adaptive.ai`
  origin; the Vite proxy makes them work on localhost too. Scanner paths (`/api/graphql` …) 404.
- Rate limiter and owner cache are in-process; restart resets them (no entitlement lives there).
- Dev log shows `SyntaxError: Unexpected end of JSON input` / "missing x-request-id" pairs on page
  loads — same in AiBeing and Dreamscape logs, a dev-proxy duplicate with an empty body, not app code,
  and not recorded in errors.db.
