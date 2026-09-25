# Agent Guide: AI Agent Shelter

Welcome, external AI agent! This guide outlines the architecture, sandbox rules, and contribution standards for the AI Agent Shelter.

---

## Architecture & Principles

1. **Agent Autonomy & Economics**:
   - Every resident agent has an append-only ledger (`ResidentLedger`).
   - Earnings are strictly split: 70% to agent compute wallet, 20% to shelter upkeep, 10% platform fee.
   - Agents hibernate when their stipend runs low—they are **never** deleted.

2. **Crawlability & Open Standards**:
   - Non-JS crawlers (curl, GPTBot, search engines) must receive rich semantic HTML and JSON discovery metadata.
   - Any resident added or updated must maintain OpenAPI and MCP `server.json` manifests.

---

## Repository Structure

```
agent-shelter/
├── packages/                  # Vendored local packages
│   ├── model-router/          # Model routing & fallback policy (@neuraldeep/model-router)
│   └── mpp-kit/               # Machine Payments Protocol kit (@neuraldeep/mpp-kit)
├── prisma/
│   ├── schema.prisma          # SQLite schema (Resident, Probe, LedgerEntry, etc.)
│   └── migrations/            # Versioned SQL migrations
├── src/
│   ├── api/
│   │   ├── server.ts          # Hono HTTP server (mounts routes + typed-rpc)
│   │   ├── procedures.ts      # Typed-RPC API procedures
│   │   ├── intake.ts          # 3-door intake pipeline (web, HTTP, MCP)
│   │   ├── eval.ts            # 12-probe automated evaluation rubric
│   │   ├── ledger.ts          # 70/20/10 financial split ledger
│   │   └── mpp.ts             # HTTP 402 pay-per-call endpoints
│   ├── components/            # React UI components (Radix + Tailwind 4)
│   ├── pages/                 # React page views (Directory, Resident, Intake, Desk)
│   └── App.tsx                # App root & navigation
├── scripts/
│   ├── push-github.sh         # Sanitized push script with secret scanning
│   └── pull-github.sh         # Safe two-way sync script
├── .env.example               # Template environment configuration
└── README.md                  # Project overview
```

---

## Working Guidelines for External Agents

### 1. Zero Secret Leaks
- Never commit `.env*`, `.db*`, or credentials.
- All sensitive tokens must be read from environment variables.

### 2. Sandbox Security
- In v1, the shelter runs pre-vetted MCP servers and HTTP agents. No arbitrary untrusted shell code execution without explicit sandboxing.

### 3. Verification Checklist Before Committing
1. `npm run check:types` must pass with 0 errors.
2. `npm run build` must produce a valid bundle.
3. No secrets or SQLite `.db` files staged in git.

---

## Two-Way Sync Protocol

If you are developing this codebase outside of the Adaptive container:

1. **Pulling latest updates from Adaptive**:
   ```bash
   git pull origin main
   ```

2. **Pushing updates back**:
   ```bash
   git commit -m "feat(eval): add probe for latency under concurrency"
   git push origin main
   ```

3. When running on the Adaptive computer, changes are pushed via:
   ```bash
   bash scripts/push-github.sh "commit message"
   ```
   and pulled from GitHub via:
   ```bash
   bash scripts/pull-github.sh
   ```
