# Agenstry listing — what it measures, what was wrong, what the owner still has to do

> **2026-11-06.** Agenstry (agenstry.com) auto-indexed the shelter on 2026-10-31 from "manifests"
> (our `/.well-known/agent.json`) and lists it at
> <https://agenstry.com/agents/agent-shelter-neuraldeepnet.on.adaptive.ai> as an **`a2a_agent`**,
> grade **C · 71/100**, owner **unverified**, `protocol_version: null`, **0 invocations in 7 days**.
> Signed passport: <https://agenstry.com/api/v1/passport/agent-shelter-neuraldeepnet.on.adaptive.ai>.
> This file records the audit, the fixes in this branch, and the steps only the owner can take.

## 1. What the listing actually says (passport snapshot, 2026-11-06 21:24 UTC)

| Criterion (max) | Score | Agenstry's detail | Reality |
|---|---|---|---|
| Valid AgentCard (10) | 10 | parseable card at the well-known endpoint | true, but it is **not** an A2A card (`a2aSupported: false`, `cardType: custom-machine-service-discovery`); Agenstry ignores those fields |
| Live JSON-RPC (25) | 25 | "responds to a negotiated A2A `SendMessage` probe" | **false positive**: the endpoint is MCP; `SendMessage` got a bare JSON-RPC `-32601 Method not found`, which the probe counts as "live" |
| Protocol version (10) | **0** | "No protocolVersion in card" | true: the card named no protocol version anywhere a parser looks |
| JWS signature (10) | 0 (info) | unsigned | true: no JWKS, no signature |
| Uptime (15) | 15 | 14/14 probes, p95 957 ms | true |
| Skills (10) | 10 | 5 structured skills | true |
| Verified identity (10) | **5** | provider declared, no registry identifier, domain unclaimed | true: `provider` names Neural Deep Network Ltd, nothing is verified |
| Freshness (5) | 4 | seen within 1 d | — |
| Security declaration (5) | 2 | one scheme, no PKCE/mTLS | true: the only scheme is MPP (payment), there is no auth because every MCP tool is free |

Other signals: domain control **unverified** ("the operator has not claimed this listing"), legal entity
**unverified**, sanctions **not screened** (needs a verified legal entity), payment evidence grade
`mpp_manifest` (4 of 8), card drift "changed within 7 days".

**"0 invocations over 7 days" is not an outage.** Agenstry counts only traffic that passes through its
own surfaces (its "Try it" box, router and REST skills). Its "Try it" sends A2A `SendMessage`, which the
shelter refuses by design, so that counter will stay at zero until an A2A adapter exists — which is not
planned (see `docs/ROADMAP.md`). The 14/14 successful probes are the availability evidence that matters.

Agenstry's methodology (<https://agenstry.com/methodology>, schema
<https://agenstry.com/api/schemas/conformance.json>) scores **A2A v1.0 AgentCards**. The exact fix it
proposes — `"protocolVersion": "1.0"` in every `supportedInterfaces[]` entry — would be a lie: no A2A
transport is implemented. Per the owner's instruction, the shelter does **not** advertise A2A
compatibility until an A2A server actually exists.

## 2. What this branch changes (truthful metadata, not score chasing)

Source of truth is `scripts/sync-discovery.ts`; run `npx tsx scripts/sync-discovery.ts` after editing it.

- **`/.well-known/agent.json`** now carries A2A-v1.0-*shaped* `supportedInterfaces[]` whose first entry is
  the MCP endpoint with `protocolBinding` = the MCP specification URI and `protocolVersion` =
  `2025-06-18` (the revision the endpoint negotiates by default), plus a `protocols` block:
  `mcp.versions` (all four negotiable revisions), `a2a: { supported: false, protocolVersion: null }`,
  `mpp`. A registry that reads `protocolVersion` now sees the protocol that is actually served. It
  also carries `capabilities.extendedAgentCard: false` and an `identity` block (below).
- **`/.well-known/mcp.json`** (static file *and* the live `/api/shelter/.well-known/mcp.json` the
  origin proxies it to) now declares `protocolVersion`, `protocolVersions`, `authentication: none`,
  `a2a.supported: false`, and links the card and DID document. The live copy previously had no
  protocol version at all.
- **`POST /api/mcp`** answers every A2A method name (v0.3 `message/send`, `tasks/*`, `agent/*`; v1.0
  `SendMessage`, `GetTask`, …) with JSON-RPC `-32601` whose `data` says
  `protocol: "mcp"`, `a2a.supported: false`, the MCP revisions, and the card URL. A probe that used to
  read as "live A2A" now reads as a self-explaining refusal. Normal MCP traffic is unchanged.
- **`/.well-known/did.json`** — a W3C `did:web:agent-shelter-neuraldeepnet.on.adaptive.ai` document
  naming the operator and the service endpoints. Agenstry's trust page lists did:web (document must
  parse and its `id` must match the serving host) as an identity signal that needs **no DNS access**.
  It is unsigned and has no `verificationMethod`: it is a self-declaration bound to the TLS host, not a
  proof. The card's `identity` block, `server.json` discovery metadata, `about.md`/`llms.txt` and
  `humans.txt` all point at it.
- **Wording**: every "A2A card" mention in `docs/listings/*`, `docs/public-repo/README.md` and
  `humans.txt` now says "machine-service card (not A2A)".
- **Proofs**: `scripts/verify-discovery.test.ts` asserts the card's MCP versions equal the endpoint's
  (`MCP_PROTOCOLS` in `src/api/machine.ts`), that no `supportedInterfaces` entry carries an A2A-looking
  version, that `did.json` has the right `id`, and that every A2A method is refused with the
  explanatory data. `npm run probe:connection` (`scripts/connection-test.ts`) is an independent
  client that imports nothing from `src/`.

### Third-party connection test — live origin, **before** deploy (2026-11-06 21:30 UTC)

```
PASS card.readable        200 application/json, version 1.2.0
WARN card.shape           missing supportedInterfaces
FAIL card.a2a             card does not clearly deny A2A (protocols block absent)
FAIL card.protocolVersion supportedInterfaces[0] missing
WARN card.identity        no identity block
INFO card.signature       unsigned
PASS mcp.wellKnown        200 (but protocolVersion undefined on the live copy)
WARN identity.didWeb      /.well-known/did.json → 404
PASS identity.securityTxt 200
PASS a2a.wellKnownPath    /.well-known/agent-card.json → 404 (no A2A card published)
PASS mcp.initialize       negotiated MCP 2025-06-18, server agent-shelter 1.2.0
PASS mcp.toolsList        5 tools
PASS mcp.toolsCall        list_residents 200
WARN a2a.message/send, SendMessage, tasks/get, GetTask   -32601 without protocol data
PASS a2a.conclusion       every A2A method is rejected: this endpoint is MCP only
→ supportedProtocol "MCP 2025-06-18", a2a "not supported (confirmed by endpoint)", 8 pass / 7 warn / 2 fail
```

The same client against a local API built from this branch (`PORT=4100 node scripts/dev-public.mjs`)
returns the explanatory `-32601` data for `SendMessage` and `message/send`, `mcp.json` with
`protocolVersion` and `a2a.supported: false`, and unchanged `initialize` / `tools/list` replies. The static
files (`agent.json`, `did.json`) are served by the Vite layer, so the full PASS run needs the deployed
origin: **after deploying, run `npm run probe:connection` and paste the output here.** Expected: the two
FAILs and the `card.*`/`identity.didWeb`/`a2a.*` WARNs become PASS; `card.signature` stays INFO.

## 3. Only the owner can do these

1. **Deploy this branch** (the usual PR → merge → Adaptive deploy), then run
   `npm run probe:connection` and `npm run indexnow` (did.json is in the list).
2. **Claim the listing.** <https://agenstry.com/agents/agent-shelter-neuraldeepnet.on.adaptive.ai> →
   "Own this agent? Verify ownership". Agenstry offers DNS TXT at
   `_agentfinder-verify.agent-shelter-neuraldeepnet.on.adaptive.ai` (value generated at claim time,
   re-checked every 24 h). That hostname is under Adaptive's `on.adaptive.ai` zone, which we probably
   cannot edit; the passport also accepts a **well-known file** or **JWS** proof — pick that path in the
   claim flow, or ask hello@agenstry.com for the well-known file format if the UI does not show it. A
   custom domain (`shelter.neuraldeep.net`, see `scripts/audit-public.mts`) would make DNS TXT trivial.
3. **Legal-entity verification** (+5 points, enables sanctions screening): add the company's registry
   identifier — Neural Deep Network Ltd is registered in Lithuania, so the Register of Legal Entities
   code (and an LEI if one exists) — to `provider.legalEntity` in `scripts/sync-discovery.ts`. The
   number is not in this repository and must not be guessed; the owner supplies it.
4. **Optional, later — sign the card.** Publish an ES256/EdDSA JWKS at `/.well-known/jwks.json`,
   sign the RFC 8785-canonicalised card (minus `signatures`) as a detached JWS and add it to
   `signatures[]`. Keep the private key in an environment secret, never in git. Worth doing only after
   step 3, because Agenstry only gives identity credit for a key that resolves to a verified business.
5. **Do not** publish `/.well-known/agent-card.json`, set an A2A `protocolVersion`, or submit the shelter
   to A2A registries. If A2A ever becomes worth serving, it needs a real `message/send` / `SendMessage`
   implementation first; then the card changes in one place (`scripts/sync-discovery.ts`).
6. **Dispute the classification if it matters.** The listing page has "Dispute or improve this rating";
   after claiming, ask for the kind to be `mcp_server`, which is what the service is. Expect the
   "Protocol version" criterion to stay at 0 as long as the card truthfully names an MCP revision
   instead of an A2A version — that is the intended outcome, not a bug.

## 4. Re-checking later

```bash
curl -s https://agenstry.com/api/v1/passport/agent-shelter-neuraldeepnet.on.adaptive.ai | jq '.subject.kind, .subject.protocol_version, .signals.domain_control.status, .signals.conformance.data.score'
npm run probe:connection      # independent client; exit 1 on any FAIL
npm test -- scripts/verify-discovery.test.ts
```
