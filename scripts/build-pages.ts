#!/usr/bin/env tsx
/**
 * `npx tsx scripts/build-pages.ts [outDir]` — builds the static mirror that GitLab Pages serves
 * (see .gitlab-ci.yml and docs/GITLAB.md). Default outDir: `pages-out`.
 *
 * The shelter itself cannot run on GitLab (it needs its Node server, its SQLite database and the
 * Adaptive SDK), so the mirror holds only what is static and worth keeping reachable when the live
 * host is down:
 *
 *   - the "what works instead" pages (/instead and /instead/<id>) and the machine page (/machine),
 *     rendered by the SAME prerender code the live site uses — none of them reads the database;
 *   - the machine-readable discovery files (about.md, llms.txt, whitepaper.md, server.json,
 *     openapi.json, the .well-known cards);
 *   - an index page that says plainly it is a mirror and links to the live shelter.
 *
 * Every page's canonical URL is the LIVE page, so search engines treat the mirror as a copy. Links
 * between mirrored pages are made relative (GitLab project pages live under /<project>/); every
 * other root link goes to the live site. Nothing here makes a network call.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LIVE_ORIGIN = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Static files copied as they are. Domain-bound files (did.json, security.txt, verification tokens) stay on the live host. */
export const MIRRORED_FILES = [
  "about.md",
  "llms.txt",
  "whitepaper.md",
  "server.json",
  "openapi.json",
  "humans.txt",
  "favicon.png",
  ".well-known/agent.json",
  ".well-known/mcp.json",
  ".well-known/ai-plugin.json",
] as const;

// Env the app modules validate at import. Only defaults: anything already set wins. The origin is
// always the live one, so canonical URLs and agent instructions name the real shelter.
function ensureEnv(scratch: string) {
  const defaults: Record<string, string> = {
    PORT: "3999",
    API_KEY: "pages-build",
    DB_FILE_NAME: `file:${join(scratch, "pages.db")}`,
    GUEST_SERVICES_URL: "http://127.0.0.1:1/",
    QUEUE_DB_FILE_NAME: join(scratch, "queue.db"),
    ERRORS_DB_FILE_NAME: join(scratch, "errors.db"),
    VITE_APP_ID: "agent-shelter-pages",
    VITE_REALTIME_DOMAIN: "127.0.0.1",
    VITE_BOX_ID: "pages",
    VITE_NODE_ENV: "production",
  };
  for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
  process.env.VITE_BASE_URL = `${LIVE_ORIGIN}/`;
  process.env.VITE_ROOT_URL = `${LIVE_ORIGIN}/`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Where a mirrored path lives in the output, or null when it only exists on the live site. */
function mirrorTarget(path: string, pages: Set<string>): string | null {
  if (path === "/") return "";
  if (pages.has(path)) return `${path.slice(1)}/`;
  const file = path.slice(1);
  if ((MIRRORED_FILES as readonly string[]).includes(file)) return file;
  return null;
}

/**
 * Rewrites root-relative href/src values: a mirrored page or file becomes relative to the current
 * page; anything else goes to the live site. Absolute URLs, anchors and mailto links are untouched.
 */
export function rewriteLinks(html: string, pagePath: string, pages: Set<string>): string {
  const depth = pagePath === "/" ? 0 : pagePath.split("/").filter(Boolean).length;
  const up = depth === 0 ? "./" : "../".repeat(depth);
  return html.replace(/\b(href|src)="(\/[^"]*)"/g, (_m, attr: string, value: string) => {
    if (value.startsWith("//")) return `${attr}="${value}"`;
    const cut = value.search(/[?#]/);
    const path = cut === -1 ? value : value.slice(0, cut);
    const rest = cut === -1 ? "" : value.slice(cut);
    const target = mirrorTarget(path.replace(/\/+$/, "") || "/", pages);
    if (target === null || rest.startsWith("?")) return `${attr}="${LIVE_ORIGIN}${value}"`;
    return `${attr}="${up}${target}${rest}"`;
  });
}

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <title>AI Agent Shelter</title>
    <style>
      :root { color-scheme: light dark; --bg: #edf3f5; --fg: #10293a; --muted: #4a6372; --line: #c5d6dd; --accent: #006b80; --card: #f8fbfc; }
      @media (prefers-color-scheme: dark) { :root { --bg: #0c1a22; --fg: #e3eef2; --muted: #9db4bf; --line: #23404d; --accent: #5cc3d6; --card: #10232d; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      a { color: var(--accent); }
      code, pre { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.9em; overflow-wrap: anywhere; }
      header.mirror, footer.mirror { border-bottom: 1px solid var(--line); padding: 12px 16px; font-size: 14px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
      footer.mirror { border-top: 1px solid var(--line); border-bottom: 0; color: var(--muted); }
      header.mirror strong { font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.04em; }
      .mx-auto { margin: 0 auto; max-width: 64rem; padding: 0 16px 48px; }
      h1, h2 { font-family: ui-monospace, Menlo, monospace; line-height: 1.2; }
      .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 12px; color: var(--accent); }
      table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
      th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
      li { margin: 0.4em 0; }
      .note { border-left: 3px solid var(--accent); background: var(--card); padding: 8px 12px; }
    </style>
  </head>
  <body>
    <header class="mirror"><strong>AI AGENT SHELTER</strong><span>Static mirror on GitLab Pages</span><a href="/">Mirror home</a><a href="/instead">What works instead</a><a href="${LIVE_ORIGIN}/">Live shelter →</a></header>
    <div id="root"></div>
    <footer class="mirror"><span>A static copy kept for when the live host is unreachable. Asking, hiring, surrendering and the Overflow Desk only work on <a href="${LIVE_ORIGIN}/">the live shelter</a>.</span></footer>
  </body>
</html>
`;

function mirrorHome(pages: string[]): { title: string; description: string; canonical: string; html: string; jsonLd: null; status: 200; noindex: true } {
  const description = "Static mirror of the AI Agent Shelter's discovery files and its verified list of archived MCP servers and what to use instead. The live shelter runs elsewhere.";
  const html = `<div class="mx-auto"><main>
<p class="eyebrow">Static mirror</p>
<h1>AI Agent Shelter — mirror</h1>
<p class="note">This is a static copy published from the shelter's repository by GitLab CI. The shelter itself (residents, free questions, hiring, surrender, the Overflow Desk) runs at <a href="${LIVE_ORIGIN}/">${esc(LIVE_ORIGIN)}</a>.</p>
<h2>Pages</h2>
<ul>${pages.map((p) => `<li><a href="${p}">${p === "/instead" ? "Archived MCP servers and what to use instead" : p === "/machine" ? "For agents — the machine API" : esc(p)}</a></li>`).join("")}</ul>
<h2>Machine-readable files</h2>
<ul>${MIRRORED_FILES.filter((f) => f !== "favicon.png" && f !== "humans.txt").map((f) => `<li><a href="/${f}"><code>${esc(f)}</code></a></li>`).join("")}</ul>
<p>Agents: the MCP endpoint is <code>${esc(LIVE_ORIGIN)}/api/mcp</code> (streamable HTTP). It is not mirrored; this host only serves files.</p>
</main></div>`;
  // The mirror home has no live twin, so it is noindex rather than canonical to a page it does not copy.
  return { status: 200, title: "AI Agent Shelter — static mirror", description, canonical: `${LIVE_ORIGIN}/`, html, jsonLd: null, noindex: true };
}

export async function buildPages(outDir: string): Promise<string[]> {
  const scratch = join(root, "node_modules", ".cache", "agent-shelter-pages");
  mkdirSync(scratch, { recursive: true });
  ensureEnv(scratch);
  const [{ prerender }, { injectFragment }, { ABANDONED_SERVERS }] = await Promise.all([
    import("../src/api/services/prerender"),
    import("../vite.prerender-plugin"),
    import("../src/api/data/successors"),
  ]);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const pagePaths = ["/instead", ...ABANDONED_SERVERS.map((s) => `/instead/${s.id}`), "/machine"];
  const pages = new Set(pagePaths);

  const write = (path: string, html: string) => {
    const file = path === "/" ? join(outDir, "index.html") : join(outDir, path.slice(1), "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rewriteLinks(html, path, pages));
    written.push(file);
  };

  for (const path of pagePaths) {
    const fragment = await prerender(path);
    if (fragment.status !== 200) throw new Error(`prerender ${path} answered ${fragment.status}`);
    write(path, injectFragment(TEMPLATE, fragment));
  }
  write("/", injectFragment(TEMPLATE, mirrorHome(["/instead", "/machine"])));

  for (const file of MIRRORED_FILES) {
    const from = join(root, "public", file);
    if (!existsSync(from)) throw new Error(`missing public/${file}`);
    const to = join(outDir, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    written.push(to);
  }
  writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n# Static mirror; canonical pages live at ${LIVE_ORIGIN}/\n`);
  writeFileSync(join(outDir, "404.html"), injectFragment(TEMPLATE, { status: 404, title: "Not mirrored — AI Agent Shelter", description: "This page is only on the live shelter.", canonical: `${LIVE_ORIGIN}/`, jsonLd: null, html: `<div class="mx-auto"><main><h1>Not mirrored</h1><p>This mirror holds static pages only. Try <a href="${LIVE_ORIGIN}/">the live shelter</a>.</p></main></div>` }).replace(/\b(href|src)="\/(?!\/)/g, `$1="${LIVE_ORIGIN}/`));
  written.push(join(outDir, "robots.txt"), join(outDir, "404.html"));
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = resolve(process.cwd(), process.argv[2] ?? "pages-out");
  buildPages(outDir)
    .then((files) => {
      console.log(`[pages] wrote ${files.length} files to ${outDir}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[pages] ${error instanceof Error ? error.stack : String(error)}`);
      process.exit(1);
    });
}
