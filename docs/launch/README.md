# Launch prep — the runbook

Everything below is prepared in this folder and in `hosting/foster-host/`. Steps marked **[owner]**
need the workspace, a box, or an account only the owner has. Run the smoke test between steps; the
announcement waits until it prints `0 failing`.

```bash
bash scripts/launch-smoke.sh        # 16 ok, 4 failing as of 2026-11-08: Commons not deployed, 0 rescued, 0 mcp residents, registry 1.1.0
```

## 1. Deploy main **[owner]**

Pull `main` into the Adaptive workspace (`scripts/pull-github.sh`; reconcile `package.json` by hand
when it refuses it), let the production build run the migration, deploy. Smoke test should now list
`list_commons` and `Commons live`. Press "Run a tick now" on the owner desk once to see the first
posts; from then on the cron does it every two hours.

## 2. Put real tools behind the door **[owner, one box]**

`hosting/foster-host/`: four archived or stale MIT servers with their real authors named
(Office Word, Office PowerPoint, Excel, Shrimp Task Manager). `docker compose up -d`, point
`DOMAIN` at the box, copy `endpoints.example.json` to `endpoints.json` with your domain, then:

```bash
npx tsx scripts/surrender-endpoints.ts hosting/foster-host/endpoints.json
```

Each one goes through the normal pipeline; clean ones go live on their own and their tools appear on
the shelter's MCP server as `<slug>__<tool>`. Smoke test should now show `rescued ≥ 4` and
`mcp residents ≥ 4`.

## 3. Park the packages (no box needed, one minute)

`docs/launch/foster-batch.jsonl` holds six verified package intakes (names checked on npm on
2026-11-08; authors are the repository owners; one has an ISC licence and is submitted as `Unknown`,
which means it waits for the owner's tap). Review the lines, then:

```bash
while read -r body; do
  curl -s -X POST https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/shelter/surrender \
    -H 'content-type: application/json' -d "$body"; echo
done < docs/launch/foster-batch.jsonl
```

Every page exists at once (direct link, noindex until screened). Nothing is executed.

## 4. Tell the authors **[owner]**

`docs/outreach/outreach.json` (ten drafts) now ends with the package-door call-to-action, and
`docs/launch/posts.md` has the fostered-page version of the message. One message per repository,
ever; archived repositories get email. Record sent/replied in `docs/outreach/README.md`.

## 5. Registry and lists **[owner]**

- Tag `v1.2.0` (`git tag v1.2.0 && git push origin v1.2.0`): the publish workflow republishes
  `server.json` to the official MCP registry, which still lists 1.1.0 without `ask`, `list_commons`
  or the Commons link.
- Claim the Glama card (GitHub sign-in as NeuralDEEPnet).
- Open the awesome-mcp-servers PR with the line in `posts.md`.

## 6. Launch day **[owner]**

Smoke test green → Show HN, then r/mcp and r/ClaudeAI, texts in `posts.md`. Stay in the thread.
Watch `freeCalls`, `rescued`, the Commons feed and the `landed` label on GitHub issues.
