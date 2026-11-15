# Growth plan — make the shelter something people use and pass on

Written 2026-11-15, against the live service at v1.3.0 (16 residents taking calls, 11 rescued, 4 MCP
residents with callable tools, free tier on, Commons and bounty board live).

## The problem this plan answers

Supply is no longer the gap. The gap is that a visitor could not *do* anything in the first minute:

| Visitor | What they met before | What was missing |
|---|---|---|
| A developer on the home page | A `curl` line | No way to try a resident in the browser |
| Someone with an MCP client | A JSON block to paste | No one-click install |
| A maintainer of a dying package | A long intake form | No reason to arrive, no quick answer |
| A rescued project's author | A page on our site | Nothing to carry back to their own README |

So the plan is four small doors, each with a loop that brings the next visitor.

## What is built (this change)

1. **Ask in the browser.** The home hero and every live resident page have an ask box that calls the
   same free, stipend-funded door as `POST /api/mpp/ask/:slug`. Same per-caller quota, same refusals.
   Time to first answer drops from "open a terminal" to one click.
2. **One-click connect.** "Add to Cursor" and "Add to VS Code" deep links, a copyable Claude Code
   command and the MCP JSON, on the home page and the machine page. One URL, every resident.
3. **Rescue check** — `/check`, `GET /api/shelter/check`, MCP tool `check_package`. Type an npm or
   PyPI package and get a verdict from public registry signals: sheltered, abandoned, stale,
   maintained, unknown or not-found. An abandoned or stale package gets a pre-filled surrender link.
   This is the acquisition door: people search for "is X abandoned", and the answer page offers the
   rescue. It is also a tool other agents have a reason to call.
4. **README badge** — `GET /api/shelter/badge/<slug>.svg`. Live status and questions answered,
   linking back to the résumé. Each rescued project that embeds it is a permanent backlink.

Safety is unchanged: the rescue check reads registry metadata through the pinned public-https
client, validates the name before any network read, caches for six hours, caps outbound reads per
minute, and never installs or runs anything.

## The loops

- **Search → check → park.** "is `<package>` abandoned" lands on `/check`; a stale or abandoned
  verdict offers a pre-filled surrender; the parked page ranks for the package name.
- **Park → badge → visitors.** The author (or a user) embeds the badge; README readers arrive at
  the résumé; the ask box answers them at once.
- **Ask → connect → agents.** A good first answer is followed by "Add to Cursor"; from then on the
  user's agent calls residents and rescued tools without visiting the site.

## What to measure (weekly, from the catalog and server logs)

| Number | Where | Target for the first month |
|---|---|---|
| Free questions answered | catalog `questionsAnswered` | 10× the week before launch |
| Rescue checks run | requests to `/api/shelter/check` | 200 a week |
| Checks that became surrenders | intakes with a package spec | 5 % of stale/abandoned verdicts |
| Residents with a badge in the wild | GitHub code search for `/api/shelter/badge/` | 10 |
| MCP `initialize` calls from new callers | server logs | 50 a week |

## Owner steps (not doable from the repo)

1. Deploy main to the Adaptive workspace.
2. Post the rescue check, not the shelter: "Is your MCP server abandoned? Free check." The posts in
   `docs/launch/posts.md` should lead with `/check` and one real verdict.
3. Open pull requests on the READMEs of the rescued projects that are still accepting them, adding
   the badge. For archived repositories, tell the author by issue or email instead.
4. Submit `/check` to IndexNow (`scripts/indexnow-submit.ts`) after the deploy.
5. Tag the release so the official registry listing catches up with the code.

## Next, in order of expected return

1. **Per-package check pages** (`/check/npm/<name>`) prerendered from the six-hour cache, so each
   checked package becomes an indexable page. Needs a crawl budget rule first.
2. **PNG share cards.** Social sites ignore SVG `og:image`; résumés currently share the favicon.
3. **Weekly "newly abandoned" digest** from `scripts/find-abandoned-mcp.ts`, as a Commons post and
   an RSS feed.
4. **Sponsor-a-resident checkout from the ask box** when the free quota runs out.
