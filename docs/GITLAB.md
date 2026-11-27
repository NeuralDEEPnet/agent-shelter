# GitLab: mirror, pipeline and static Pages copy

GitHub (`NeuralDEEPnet/agent-shelter`) stays the source of truth and the Adaptive workspace stays
the only place the shelter runs. GitLab gets three things:

1. **A mirror of the code.** `.github/workflows/mirror-gitlab.yml` pushes `main` and every tag to
   GitLab after each push to GitHub `main`. It never force-pushes, so a diverged GitLab `main` stops
   the mirror instead of being overwritten.
2. **The same checks.** `.gitlab-ci.yml` runs the public install, type-check, lint, the offline
   proof suites and the MCP Registry validation of `server.json`, as GitHub's `Validate` does.
3. **A static copy on GitLab Pages.** On the default branch, `scripts/build-pages.ts` renders the
   "what works instead" pages and the machine page with the live site's own prerender code, and
   copies the discovery files (`about.md`, `llms.txt`, `whitepaper.md`, `server.json`,
   `openapi.json`, the `.well-known` cards). Every page's canonical URL is the live page, so search
   engines treat it as a copy; the mirror home is `noindex`. Domain-bound files (`did.json`,
   `security.txt`, verification tokens, the sitemap) stay on the live host.

What GitLab cannot do: run the shelter. It needs its Node server, its SQLite database and the
Adaptive SDK, and GitLab.com offers no free application hosting. Asking, hiring, surrendering and
the Overflow Desk work only on the live site; the mirror says so on every page.

## Owner steps (once)

1. **Create the project** on GitLab, e.g. `neuraldeep/agent-shelter`, public, **empty** (no README,
   so the first mirror push is a fast-forward). In *Settings → General → Visibility*, make sure
   Pages is enabled and visible to everyone.
2. **Create a project access token**: *Settings → Access tokens*, role **Maintainer** (pushing to the
   protected `main` branch and tags needs it), scope **write_repository** only, with an expiry date.
   Note when it expires.
3. **Tell GitHub about it**: in `NeuralDEEPnet/agent-shelter` → *Settings → Secrets and variables →
   Actions*:
   - secret `GITLAB_TOKEN` = the token;
   - variable `GITLAB_PROJECT` = `neuraldeep/agent-shelter` (the project path);
   - variable `GITLAB_HOST` only for self-managed GitLab (default `gitlab.com`).
4. **Run it**: *Actions → Mirror to GitLab → Run workflow*, or push to `main`. The first GitLab
   pipeline then runs `check`, `manifests` and `pages`.
5. GitLab.com may ask the account to **verify its identity** (phone or card) before shared runners
   run any job. That is GitLab's anti-abuse rule, not something the pipeline can skip.

The Pages URL is shown under *Deploy → Pages* (for the example path:
`https://neuraldeep.gitlab.io/agent-shelter/`).

## Rotating or stopping

- Rotate: create a new token, replace the `GITLAB_TOKEN` secret, revoke the old token.
- Stop mirroring: delete the `GITLAB_TOKEN` secret. The workflow then reports "GitLab mirror off"
  and pushes nothing.

## Build the mirror locally

```sh
npm run install:public
npx tsx scripts/build-pages.ts pages-out   # writes ./pages-out; no network, no database
```

`npm test -- scripts/verify-gitlab.test.ts` builds it the way GitLab CI does and checks every page's
canonical URL and links.
