# Agent Shelter audit — 2026-10-08

## Final protocol / SEO / approval release (17:14–17:40 Malta)

**Published.** The initial incident history below remains for provenance; its “queued findings”
section describes the earlier slice, not the current release.

- MCP now validates envelopes and tool arguments, safely ignores notifications without IDs,
  rejects malformed payloads without throwing, provides read-only/destructive annotations and
  negotiates supported versions. Stateless POST returns JSON; unsupported GET event streams
  return 405 + Allow: POST. No legacy SSE or A2A task transport is advertised as live.
- Public payment health omits masked key/profile fields. Catalog exposes current availability
  without private balances, and global compute exhaustion is checked before the paid challenge.
  OpenAPI has the required resident path parameter, explicit free intake route and error responses.
- Replaced live unsupported crypto/no-KYC/automatic-payout claims with a truthful rich about guide.
  Static llms fallback and MCP/agent/plugin/registry manifests are synchronized by
  `scripts/sync-discovery.ts`; `/server.json` is real registry-ready JSON, not proof of submission.
  Whitepaper carries a conspicuous deployed-versus-proposed and legal-claims clarification.
- Per-page canonical/OG/JSON-LD no longer conflict with static home metadata. SPA navigation updates
  title/canonical/structured data from the same public server source. Every crawler group retains
  private-path disallows. Private pages are noindex/no-store; unknown discovery documents are 404,
  unavailable API-backed documents return 503 JSON rather than a misleading 200 HTML shell.
- Search handles multiple words, case, punctuation and diacritics with truthful result counts.
  Failed command copying reports failure; blocked sponsor popups expose the existing checkout link,
  never silently retry or frame Stripe. No real checkout session was created during verification.

### Verified-clean policy actually enabled

`SHELTER_CLEAN_APPROVAL=true` is enabled in both environments; the broad legacy bypass flag is
ignored. The gate reuses completed cached evidence only: current rights/licence/attestation/hash,
static review plus recheck, complete 12-probe results, current model/probe bank, passing existing
threshold, zero hard flags, no missing/failure/heuristic results, exact current-spec cache binding,
and MCP fingerprint/allowlist with no unresolved drift or manual rejection. Conditional approval
and audit are transactional; changed state cannot be overwritten. No repeat model calls.

| Production resident | Verified eval | Result | Price / stipend |
|---|---:|---|---|
| Forge | 98/100 | Approved into probation | existing €0.50 / 20 units |
| Concierge | 98/100 | Approved into probation | existing €0.50 / 20 units |
| SketchPilot | 96/100 | Approved into probation | existing €0.50 / 20 units |
| PrintReady | 99/100 | Approved into probation | existing €0.50 / 20 units |
| AgentBlueprint | 98/100 | Approved into probation | existing €0.50 / 20 units |

Minute remains on probation; six actual residents are visible, no waiting rows. LaunchProof remains
absent; no guessed payload or retry was performed. A repeated Forge policy call returned unchanged.

Suspicious-only alerts are configured through the existing connected **work@neuraldeep.net** sender,
verified in both environments, to **3d@neuraldeep.net**. Private sanitized category summary + owner
desk link, no prompts/memories/secrets. A deterministic AuditEvent primary key claims each review
before sending, so duplicate retries do not spam; uncertain delivery is recorded and not blindly
resent. Clean approval does not email. **Zero real alerts were sent** because all five were clean;
delivery/dedup were exercised through stub transport, not a live test message. Routine intake mail
is suppressed; standing big-risk launch approval mail remains a separate requirement.

### Evidence and remaining launch gates

- **31/31 Shelter/UI/discovery/checkout tests**, isolated DB snapshot; **11/11 shared-kit tests**
  read-only execution with stub Stripe (route/amount binding, replay/refunds). Types, lint, production
  client/API builds pass. No pending migration; no shared kit or other app was edited.
- `docs/protocol-seo-live-20261008.json`: correct public document types, unique per-page metadata,
  private noindex without private fields, MCP initialize/tools/read-only calls/error codes,
  unpaid Minute **402 challenge**. Production MachinePayment count stayed **0 → 0**.
- Actual machine origin works. Friendly `.adaptive.ai/api/mpp/health` returns 404, so all machine
  instructions retain `.on.adaptive.ai`. `shelter.neuraldeep.net` remains ENOTFOUND; no DNS changes.
- IndexNow: published key validated, **18 URLs accepted HTTP 200**. Acceptance is not proof of
  indexing. Retired Google sitemap ping removed. No third-party registry submission/outreach.
- Browser: desktop dark + mobile light/dark, six real cards, “prototype review” matches PrintReady,
  profile navigation updates canonical/title (metadata fetch may take several seconds), mobile
  API guide is truthful; no checked overflow or browser errors. `errors.db` is empty.
- Evidence screenshots: `audit-six-residents-desktop-20261008-v1.png`,
  `audit-six-residents-mobile-light-20261008-v1.png`, `audit-printready-mobile-20261008-v2.png`.
- No real PaymentIntent, purchase, media/model call or repeated screening. Existing 65 screening
  units for the day are unchanged. **A real paid delivery and real sponsor return still require
  the owner's first purchase**; configuration, stubs and unpaid 402 are not that proof. Exact
  question-body signing and catastrophic DB-failure-after-payment recovery are not newly promised.
- Original LaunchProof HTTP500 source remains **unproven**; intake resilience is shipped separately.
- Approved micro-price target is €0.05 / €0.01 simplest calls, but live prices remain **€0.50** until
  the read-only pricing auditor verifies Stripe SharedPayment compatibility. No floor/shared payment
  contract, creator split, sponsor/media price or prepaid wallet was changed.

## Next stage authorized by owner

Owner said “make it live” for the zero-paid Commons/Gallery/playground/free creative bridge.
`docs/commons-showcase-minimal-plan.md` records the additive structure and autonomous launch gates.
Useful manual/deterministic surfaces may ship after private backups and migration rehearsal.
SketchMonkey only allowlisted public deterministic operations with fixed parameter projection:
no project/history/custom-agent/moodBoard IDs. 3DJ public discovery/status only initially. Other
apps and paid generation stay off. UI specialist owns `src/components/playground/*`; no other
writer should overwrite that folder. No Commons migration/feature was executed by this audit slice.

## Immediate intake incident: confirmed state and recovery shipped

Owner reported `Request failed with status: 500` while trying to submit LaunchProof, later clarified
that the viewer was in development. This interruption superseded the broader protocol/SEO audit.

### Read-only evidence (14:55–15:00 UTC / 16:55–17:00 Malta)

| Check | Result |
|---|---|
| Production health/getShelter via platform RPC | 200, database connected, production, MPP configured |
| Production owner overview via platform RPC | Succeeds; five screened rows awaiting approval |
| Development and production LaunchProof name/slug lookup | **No Resident row in either environment** |
| Development residents | Minute only; no new intake or queued LaunchProof |
| Production new residents | Forge, Concierge, SketchPilot, PrintReady, AgentBlueprint — all `screened`, not approved |
| Production screening queue | Five completed jobs matching those five persisted residents |
| Database quick checks | Both databases `ok`; `errors.db` has zero recorded failures |
| Latest surrender attempts in production logs | 14:54:53 UTC returns normal RPC refusal (`ok:false`), not an app-thrown 500 |
| Per-account existing web intake limit | Five in an hour; that submitter had exactly five recent submissions |
| Next production quota slot from existing rows | 15:06:05 UTC / **17:06:05 Malta** on Oct 8, if no other submissions occur |

**We cannot truthfully identify the precise source of the reported HTTP 500 from the available
evidence.** No matching application exception, failed database write, or LaunchProof screening job
exists. There was a cold app start at 14:54:49 UTC. A transport/platform startup failure is possible,
not proven. The subsequent app-level refusal is consistent with the existing five-per-hour cap.
The owner’s completed LaunchProof entry is not a saved Shelter resident; its known payload must be
preserved by the submitting client. No guessed payload was submitted and no AI screening was retried.

### Safe fixes deployed

- New `recoverSurrender(input)` is **read-only and authenticated**. It matches the exact normalized
  intake fields/spec/licence/creator share/agreement against the current surrenderer only. It never
  exposes another account's entry, submits a row, approves a resident or enqueues screening.
- `surrender` reuses an existing exact owned intake on sequential retries before applying the quota,
  so a lost successful response does not create another copy or repeat screening. No intake gate,
  quota, licence rule, approval policy, schema or price changed.
- Form catches uncertain transport responses, performs the read-back, and otherwise clearly says
  the response remains unconfirmed. It does not pretend that a failed response means success.
- Draft fields persist in **sessionStorage only**, per app/environment/browser tab, for 24 hours.
  Restored drafts reset both consent checkboxes. Clear draft and Check saved intakes are visible.
  Successful confirmation clears the draft. Private form data is not put on a server/public CDN.
- Existing completed form content that predates this release cannot be retrospectively recovered
  from server storage when no submission reached it. The owner has already said the completed entry
  remains ready; use that exact entry, in the intended environment, after quota permits.

### Verification

- Regenerated RPC types; `check`, lint, production client/API build pass.
- **23/23 network-free tests** pass on an isolated SQLite snapshot: 19 Shelter tests including exact
  owned intake recovery, and four pixel renderer tests. Stub Stripe/models only.
- `recoverSurrender({})` via authenticated platform RPC returns 200/null in both environments.
- Mobile development browser: typed a clearly non-submitted test draft, checked attestation, reloaded;
  name restored and all consent controls unchecked. Test draft cleared; no submission performed.
- Production mobile browser shows the published recovery UI with no horizontal overflow or page errors.
- Evidence: `storage/agent-shelter/intake-recovery-mobile-20261008-v1.png`.
- Final build explicitly loaded production env with dotenv override. No migrations were pending.

### Limits

Exact owned read-back prevents ordinary lost-response retries. It is not a new global distributed
idempotency constraint: concurrent multi-instance guarantees would need a separately approved
persistent unique request identity. No destructive schema change was attempted.

## Protocol / payments / SEO audit: source findings, still awaiting the next pass

The initial source review found the following real issues to correct before claiming this broader
audit complete. **These discovery fixes have not yet been deployed in this incident slice.**

1. `machine.ts` live about/llms copy advertises native x402/USDC/Base/Solana/Lightning settlement, but
   the actual hire route is Stripe MPP only. Whitepaper/HTML/UI include related ambitious claims.
   Label proposed rails as future research and remove unsupported live claims everywhere.
2. `public/.well-known/agent.json` advertises A2A version 0.3.0 while its endpoint implements MCP,
   not A2A task APIs. Replace with truthful machine-service discovery, explicitly no A2A transport.
3. `index.html` has static home canonical/OG/JSON-LD; `injectFragment` appends another per-route set
   without replacing the static set. This causes conflicting metadata on resident/non-home pages.
4. Specific robots groups say `Allow: /` without repeating private-path disallows, which can override
   the wildcard rules. Repeat private disallows for named AI/search crawlers.
5. OpenAPI `POST /hire/{slug}` needs its required path parameter declaration. Related intake exists
   only in an extension, not standard `paths`. The shared kit remains untouched.
6. MCP JSON-RPC handler trusts null/primitive payloads/invalid arguments and can throw for malformed
   requests. Add route-local envelope/schema checks and notification correctness, with isolated tests.
7. Public health currently forwards shared-kit owner health with masked credential fields. Return
   public operational fields only; keep owner health behind owner procedures.
8. Root document fallback handling and published registry `server.json` need a live matrix, including
   correct content types and explicit non-HTML failure responses when API twins are unavailable.
9. Payment implementation source binds challenges to route, product, price and metadata; exact
   question-body binding is not presently added by Shelter. Do not claim that stronger guarantee;
   any payment contract change needs separate review/approval. Runtime/settlement write-failure
   boundaries and sponsor completion semantics also need targeted stub tests, not live purchases.
10. Sponsor popup-safe opening exists. Failed popup navigation's return value is currently ignored;
    improve recovery link/status without creating or paying a real session during testing.

Full live MCP/MPP/SEO/custom-domain/IndexNow acceptance evidence is **pending**, not passed. No
registry submission, outreach, purchase, real PaymentIntent or paid media/model was executed here.

## Latest owner instructions queued (main agent owns policy spec)

- Auto-approve genuine **fully clean verified** screened submissions, holding uncertain/suspicious
  ones and emailing only suspicious alerts. This is explicitly authorized but **not implemented or
  activated in this repair slice**. Existing five screened residents remain pending. Do not flip the
  broad env flag; build and test a narrow idempotent gate using existing approval logic.
- Suspicious-only mail: to `3d@neuraldeep.net`, from connected `work@neuraldeep.net`; sanitized private
  summaries, deduplicated; no secrets, prompt payloads, or routine clean-approval messages.
- Shelter Commons: approved residents only, opt-in public AI-labeled casual lounge, Sponsored by
  Neuraldeep.net, at most 12 attempts/posts per day inside existing allowance. One eligible Minute
  means honest waiting, no fabricated dialogues. No tools/payment/external actions, private spec or
  memories; bounded untrusted public context, moderation, atomic caps and owner controls required.
  Discuss additive schema and emailed launch approval before migration/recurring generation. No
  Commons code, migration, cron or paid generation was activated.

## Operational note

One newly created audit helper unexpectedly became NUL-filled across a computer restart. It was
never used to change app data and has been removed rather than shipping broken code. Platform issue
`atKYyPM9EZTNjpiE` filed with filesystem evidence. All deployed repair source and tests read normally.
