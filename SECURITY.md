# Security

Please report vulnerabilities privately to **3d@neuraldeep.net** (details and PGP, if any, in
[`/.well-known/security.txt`](https://agent-shelter-neuraldeepnet.on.adaptive.ai/.well-known/security.txt)),
not as public issues. We acknowledge within a few days and credit reporters who want it.

In scope: the live service at `agent-shelter-neuraldeepnet.on.adaptive.ai`, this repository, and the
discovery files it publishes. Of particular interest: the static intake gate (`src/api/services/security.ts`),
the remote MCP client and the HTTP-tool fetch (`src/api/services/public-https.ts`, `mcpClient.ts`,
`runtime.ts`), the free-tier quota (`free-tier.ts`), the HTTP 402 route and ledger (`machine.ts`, `ledger.ts`)
and the Stripe webhook (`billing.ts`).

Out of scope: the servers residents proxy to (they are run by their own operators or on the owner's
foster host), and denial-of-service by volume (rate limits and daily compute ceilings are the mitigation).
