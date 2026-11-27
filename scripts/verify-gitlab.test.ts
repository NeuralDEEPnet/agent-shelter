// GitLab proofs: the static Pages mirror (scripts/build-pages.ts) is built exactly as GitLab CI
// builds it — a child process with no shelter env of its own — and every page keeps the live
// canonical, relative links between mirrored pages and no link that would break under the
// project's Pages subpath. The CI and mirror workflow files are checked for the rules that keep
// the token safe. No network.
//
//   npm test -- scripts/verify-gitlab.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const { ABANDONED_SERVERS } = await import("../src/api/data/successors");
const { LIVE_ORIGIN, MIRRORED_FILES, rewriteLinks } = await import("./build-pages");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("pages mirror: built the way GitLab CI builds it — live canonicals, relative internal links, nothing root-relative, no domain-bound files", () => {
  const out = mkdtempSync(join(tmpdir(), "shelter-pages-"));
  try {
    // GitLab CI has none of the shelter's env: strip it so the script's own defaults are what is proven.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITE_|DB_FILE_NAME|QUEUE_DB|ERRORS_DB|API_KEY|GUEST_SERVICES_URL|PORT$)/.test(k)));
    const run = spawnSync("npx", ["tsx", "scripts/build-pages.ts", out], { cwd: root, env, encoding: "utf8" });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

    const files = walk(out).map((f) => relative(out, f));
    for (const s of ABANDONED_SERVERS) assert.ok(files.includes(join("instead", s.id, "index.html")), `instead/${s.id}`);
    for (const f of ["index.html", "instead/index.html", "machine/index.html", "404.html", "robots.txt", ...MIRRORED_FILES]) assert.ok(files.includes(f), f);
    for (const f of [".well-known/did.json", ".well-known/security.txt", "security.txt", "sitemap.xml"]) assert.ok(!files.includes(f), `${f} is bound to the live domain and must not be mirrored`);

    for (const f of files.filter((x) => x.endsWith(".html"))) {
      const html = readFileSync(join(out, f), "utf8");
      assert.ok(!/\b(?:href|src)="\/(?!\/)/.test(html), `${f} keeps a root-relative link, which breaks under /<project>/ on GitLab Pages`);
      // Page text may mention localhost (e.g. Chrome's --browser-url); no link or canonical may point there.
      assert.ok(!/\b(?:href|src|content)="https?:\/\/(?:127\.0\.0\.1|localhost)/.test(html), `${f} links to a local origin`);
      assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1, `${f} has exactly one canonical`);
      assert.ok(html.includes("Static mirror on GitLab Pages"), `${f} says it is a mirror`);
    }
    const github = readFileSync(join(out, "instead/github/index.html"), "utf8");
    assert.match(github, new RegExp(`<link rel="canonical" href="${LIVE_ORIGIN}/instead/github" />`));
    assert.match(github, /href="\.\.\/\.\.\/instead\/"/, "the back link stays inside the mirror");
    assert.match(github, /<meta name="robots" content="index, follow" \/>/);
    const home = readFileSync(join(out, "index.html"), "utf8");
    assert.match(home, /<meta name="robots" content="noindex" \/>/, "the mirror home has no live twin, so it is not indexed");
    assert.match(home, /href="\.\/instead\/"/);
    assert.match(readFileSync(join(out, "404.html"), "utf8"), new RegExp(`href="${LIVE_ORIGIN}/"`), "404 links go to the live host: Pages serves it at any depth");
    assert.equal(readFileSync(join(out, "server.json"), "utf8"), readFileSync(join(root, "public/server.json"), "utf8"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("pages mirror: link rewriting — mirrored pages and files go relative, the rest to the live host, absolute links untouched", () => {
  const pages = new Set(["/instead", "/instead/github", "/machine"]);
  const html = `<a href="/">h</a><a href="/instead">i</a><a href="/instead/github#use">g</a><a href="/about.md">a</a><a href="/check">c</a><a href="/instead?x=1">q</a><a href="/api/mcp">m</a><a href="https://example.com/">e</a><a href="//cdn.example/x">p</a><a href="#top">t</a><img src="/favicon.png">`;
  assert.equal(
    rewriteLinks(html, "/instead/github", pages),
    `<a href="../../">h</a><a href="../../instead/">i</a><a href="../../instead/github/#use">g</a><a href="../../about.md">a</a><a href="${LIVE_ORIGIN}/check">c</a><a href="${LIVE_ORIGIN}/instead?x=1">q</a><a href="${LIVE_ORIGIN}/api/mcp">m</a><a href="https://example.com/">e</a><a href="//cdn.example/x">p</a><a href="#top">t</a><img src="../../favicon.png">`,
  );
  assert.equal(rewriteLinks(`<a href="/instead/">x</a><a href="/machine">m</a>`, "/", pages), `<a href="./instead/">x</a><a href="./machine/">m</a>`);
});

test("gitlab ci and the mirror workflow: same checks as GitHub, Pages only from the default branch, token only through env and a masked header", () => {
  const ci = readFileSync(join(root, ".gitlab-ci.yml"), "utf8");
  for (const step of ["node scripts/install-public.mjs", "npm run check:types", "npm run lint", "npm test", "./mcp-publisher validate server.json", "npx tsx scripts/build-pages.ts pages-out"]) assert.ok(ci.includes(step), step);
  assert.match(ci, /pages:[\s\S]*?rules:\s*\n\s*- if: \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/);
  assert.match(ci, /artifacts:\s*\n\s*paths: \[public\]/);

  const gh = readFileSync(join(root, ".github/workflows/validate.yml"), "utf8");
  for (const step of ["node scripts/install-public.mjs", "npm run check:types", "npm run lint", "npm test", "./mcp-publisher validate server.json"]) assert.ok(gh.includes(step), `GitHub runs ${step} too, so the two pipelines prove the same thing`);

  const mirror = readFileSync(join(root, ".github/workflows/mirror-gitlab.yml"), "utf8");
  const runLines = mirror.split("\n").filter((l) => !/^\s*(GITLAB_TOKEN|GITLAB_PROJECT|GITLAB_HOST):/.test(l));
  assert.ok(!runLines.some((l) => l.includes("secrets.")), "secrets are read once into env, never interpolated into a script");
  assert.match(mirror, /GITLAB_TOKEN: \$\{\{ secrets\.GITLAB_TOKEN \}\}/);
  assert.match(mirror, /::add-mask::\$auth/);
  assert.ok(!/https:\/\/[^"\s]*\$\{?GITLAB_TOKEN/.test(mirror), "the token never goes into a URL");
  assert.ok(!/push[^\n]*--force|push[^\n]*\s-f\b/.test(mirror), "the mirror never force-pushes");
  assert.match(mirror, /permissions:\s*\n\s*contents: read/);
  assert.ok(existsSync(join(root, "docs/GITLAB.md")), "owner steps are documented");
});
