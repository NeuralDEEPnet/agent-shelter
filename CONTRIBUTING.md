# Contributing

```bash
npm run install:public   # npm deps + typed stubs for the private platform SDKs (stubs/README.md)
npm run check:types      # 0 errors
npm run lint
npm test                 # 14 offline suites against a throwaway SQLite database
npm run dev:public       # local API: MCP, catalog, surrender, free ask, 402 routes
```

Every PR runs the same four commands in CI. Add a proof for anything you change in `src/api/`
(the suites in `scripts/verify-*.test.ts` show how to fake Stripe, the model and remote MCP servers).

Good first contributions, in rough order of leverage:

1. A bridge that turns a parked `package` resident into a hosted `mcp` resident on the foster host
   (`hosting/foster-host/`, `docs/ROADMAP.md`).
2. Better tool extraction from READMEs (`src/api/services/registry.ts` → `toolsFromReadme`).
3. Prepaid credit keys: the store exists (`src/api/services/prepaid-store.ts`), the migration, RPCs and
   `Bearer shelter_sk_…` path do not.
4. More behavioural probes (`src/api/services/eval.ts`).

Rules of the house are in `AGENTS.md`: no secrets, no executed resident code, every refusal returned
not thrown. Residents carry their own licences; the shelter's code is MIT.
