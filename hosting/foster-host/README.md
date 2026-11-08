# Foster host — run rescued MCP servers so the shelter has real tools on day one

The shelter never runs surrendered code. This folder is for the **one box you control** (a €5 VPS, a
spare machine, a Fly/Railway app) that runs a handful of well-known abandoned MCP servers behind
HTTPS and surrenders their endpoints through the normal `mcp` door. After that, every one of their
tools is callable for free on the shelter's MCP server as `<slug>__<tool>`, their pages show real
tool lists, and the outreach can say "your server is already running and callable here" instead of
"please stand up hosting for us".

Most abandoned servers speak only stdio. [`supergateway`](https://www.npmjs.com/package/supergateway)
turns a stdio server into a Streamable-HTTP endpoint without touching its code; some (e.g. the
archived Office Word / PowerPoint servers) already support `streamable-http` via a flag or env var.

## 1. Pick servers

Pure-compute, permissively licensed, no secrets needed. Good first candidates from
`docs/outreach/outreach.json`:

| Server | Licence | Transport | Notes |
|---|---|---|---|
| GongRzhe/Office-Word-MCP-Server | MIT | stdio, bridged by supergateway | archived; PyPI `office-word-mcp-server` 1.1.11; creates/edits .docx |
| GongRzhe/Office-PowerPoint-MCP-Server | MIT | native `--transport http --port 8000` | archived; PyPI `office-powerpoint-mcp-server` 2.0.7; builds .pptx |
| negokaz/excel-mcp-server | MIT | stdio, bridged by supergateway | npm `@negokaz/excel-mcp-server` 0.12.0; reads/writes .xlsx |
| cjo4m06/mcp-shrimp-task-manager | MIT | stdio, bridged by supergateway | npm `mcp-shrimp-task-manager` 1.0.21; task planning memory for agents |
| any other stdio server | MIT/Apache | `supergateway --stdio "<cmd>" --outputTransport streamableHttp` | copy one of the bridged services |

Skip anything that needs an API key, reads the filesystem outside its working directory, or shells out.

## 2. Run them (docker compose + Caddy for TLS)

```bash
cp .env.example .env            # DOMAIN=foster.example.com
docker compose up -d            # one container per server + Caddy on :443
curl -s -X POST https://$DOMAIN/word/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400   # expect a tools array
```

Each service in `docker-compose.yml` is reachable at `https://$DOMAIN/<name>/mcp` (`word`, `powerpoint`,
`excel`, `shrimp`). Caddy only forwards `POST`/`OPTIONS` to the MCP paths; nothing else on the box is exposed.
`endpoints.example.json` already describes these four with their real authors; copy it to `endpoints.json`
and replace `foster.example.com` with your domain.

## 3. Surrender the endpoints (original authors stay the creators)

```bash
# endpoints.json: one entry per server — name, tagline, story, creator (the original author), licence, endpoint
npx tsx scripts/surrender-endpoints.ts hosting/foster-host/endpoints.example.json --dry-run   # prints the intake bodies
npx tsx scripts/surrender-endpoints.ts hosting/foster-host/endpoints.json                      # POSTs to the live door
```

The script posts each entry to `POST /api/shelter/surrender` with `spec.kind = "mcp"`, the
author as `creatorName`/`creatorContact` and a 10 % creator share, and prints the slug and page.
The shelter then fingerprints the tools from your box, screens, and (clean) goes live on its own.

## 4. Tell the authors

Now the outreach drafts in `docs/outreach/` can lead with the artefact: *"We are running
`<server>` at `/r/<slug>`; its tools are callable through the shelter's MCP server; you keep the
10 % creator share — claim it, change anything, or ask us to take it down."* One message per
repository, ever.

## Operating notes

- Re-fingerprinting happens daily; if you upgrade a server and its tool list changes, the resident
  goes back to `screened` for re-approval (drift protection) — expected.
- Keep the box small and dumb: no credentials inside containers, read-only root filesystems
  (`read_only: true` in compose), per-container memory limits, and nothing but Caddy on the host.
- The shelter proxies with a 10 s timeout and a 256 KiB response cap; servers that stream large
  files will need to return links, not bodies.
