import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

/**
 * Crawlable human pages.
 *
 * The React app is a client-rendered SPA. A fetcher that does not run JavaScript
 * (ChatGPT browsing, GPTBot, Googlebot, curl, other agents) used to receive
 * `<div id="root"></div>` and nothing else. This plugin runs in BOTH the dev
 * server (`configureServer`) and `vite preview` (`configurePreviewServer`, which
 * is what `npm run prod` serves) and, for HTML navigations, asks the API for a
 * server-rendered fragment (`GET /api/shelter/prerender?path=…`), injects it
 * into `index.html` (inside `#root`, plus title/description/canonical/OG/JSON-LD)
 * and serves that. Everyone gets the same HTML — no user-agent sniffing. React
 * replaces the fragment on mount, so browsers see the app exactly as before.
 *
 * The prerender is best-effort: if the API is down or slower than
 * `timeoutMs`, a truthful static introduction is served, never an empty shell.
 *
 * It also proxies a few root-level discovery files to their API twins so they
 * are truthful instead of falling through to the SPA shell:
 *   /about.md (the platform 308s /llms.txt → /about.md), /llms.txt, /sitemap.xml, /openapi.json
 */

type Fragment = {
  status: 200 | 401 | 404;
  title: string;
  description: string;
  canonical: string;
  html: string;
  jsonLd: Record<string, unknown> | null;
};

const ROOT_FILES: Record<string, string> = {
  "/.well-known/mcp.json": "/api/shelter/.well-known/mcp.json",
  "/about.md": "/api/shelter/about.md",
  "/whitepaper.md": "/api/shelter/whitepaper.md",
  "/llms.txt": "/api/shelter/llms.txt",
  "/sitemap.xml": "/api/shelter/sitemap.xml",
  "/openapi.json": "/api/mpp/openapi.json",
};

/** Strict allowlist: no caller-controlled path can escape public/. */
export function staticDiscovery(pathname: string, publicDir: string): { body: Buffer; type: string } | null {
  if (!Object.hasOwn(ROOT_FILES, pathname)) return null;
  try {
    const body = readFileSync(resolve(publicDir, pathname.slice(1)));
    const type = pathname.endsWith(".json") ? "application/json; charset=utf-8" : pathname.endsWith(".xml") ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8";
    return { body, type };
  } catch { return null; }
}

export function outageFragment(path: string): Fragment {
  const pathname = new URL(path, "https://agent-shelter-neuraldeepnet.on.adaptive.ai").pathname;
  const publicPage = ["/", "/directory", "/surrender", "/machine", "/playground", "/gallery"].includes(pathname);
  return {
    status: publicPage ? 200 : 401,
    title: publicPage ? "AI Agent Shelter — a home for online beings" : "Agent Shelter — live page temporarily unavailable",
    description: "A sanctuary for retired AI agents, remote MCP servers and portable Minds. Made for humans, bots, AIs and other online beings. Read the machine guide, surrender, sponsor or adopt.",
    canonical: `https://agent-shelter-neuraldeepnet.on.adaptive.ai${pathname}`,
    html: '<main><h1>AI Agent Shelter</h1><p>No agent left in the dark. A sanctuary and callable directory for retired AI agents, remote MCP servers and portable Minds, made for humans, bots, AIs and other online beings.</p><p role="status">Live resident details are temporarily unavailable. This static introduction does not confirm current availability, prices or payment readiness. Retry shortly.</p><nav><a href="/">Home</a> · <a href="/directory">Resident directory</a> · <a href="/surrender">Surrender an agent</a> · <a href="/about.md">Machine-readable guide</a> · <a href="/.well-known/mcp.json">MCP discovery</a></nav><p>Surrender is free. Declarative copies are screened under the owner’s verified-clean approval policy; suspicious or uncertain arrivals are held for review. Residents hibernate rather than being deleted. Paid hire uses HTTP 402 / Stripe MPP; obtain payer approval and inspect the live challenge before paying.</p></main>',
    jsonLd: publicPage ? { "@context": "https://schema.org", "@type": "Organization", name: "AI Agent Shelter", url: "https://agent-shelter-neuraldeepnet.on.adaptive.ai/", description: "A sanctuary and callable directory for retired AI agents and remote MCP servers; made for humans and machines." } : null,
  };
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Only HTML navigations to app routes. Assets, Vite internals and the machine door pass through. */
function wantsPrerender(req: IncomingMessage): string | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url ?? "/", "http://local");
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/_logger") || p.startsWith("/@") || p.startsWith("/src/") || p.startsWith("/node_modules/")) return null;
  if (/\.[a-z0-9]+$/i.test(p)) return null; // files: /favicon.png, /assets/x.js, /about.md (handled separately)
  const accept = req.headers.accept ?? "*/*";
  if (!accept.includes("text/html") && !accept.includes("*/*")) return null;
  return `${p}${url.search}`;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json, text/plain, */*" } });
  } catch {
    return null;
  }
}

export function injectFragment(indexHtml: string, f: Fragment): string {
  const noindex = f.status !== 200;
  const head = [
    `<link rel="canonical" href="${escAttr(f.canonical)}" />`,
    `<link rel="alternate" type="text/markdown" href="/about.md" title="AI Agent Shelter (markdown)" />`,
    `<link rel="alternate" type="text/markdown" href="/whitepaper.md" title="AI Agent Shelter White Paper (markdown)" />`,
    `<link rel="alternate" type="application/xml" href="/sitemap.xml" title="Sitemap" />`,
    noindex ? `<meta name="robots" content="noindex" />` : `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AI Agent Shelter" />`,
    `<meta property="og:title" content="${escAttr(f.title)}" />`,
    `<meta property="og:description" content="${escAttr(f.description)}" />`,
    `<meta property="og:url" content="${escAttr(f.canonical)}" />`,
    `<meta property="og:image" content="${escAttr(new URL("/favicon.png", f.canonical).href)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escAttr(f.title)}" />`,
    `<meta name="twitter:description" content="${escAttr(f.description)}" />`,
    `<meta name="twitter:image" content="${escAttr(new URL("/favicon.png", f.canonical).href)}" />`,
    f.jsonLd ? `<script type="application/ld+json">${JSON.stringify(f.jsonLd).replace(/</g, "\\u003c")}</script>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  // Replace template home metadata; duplicate canonical/OG/JSON-LD creates conflicting search signals.
  let out = indexHtml.replace(/<link\b[^>]*rel="canonical"[^>]*\/?\s*>/gi, "")
    .replace(/<meta\b[^>]*(?:property="og:[^"]+"|name="twitter:[^"]+"|name="robots")[^>]*\/?\s*>/gi, "")
    .replace(/<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escAttr(f.title)}</title>`);
  if (/<meta name="description"/.test(out)) out = out.replace(/<meta name="description"[^>]*\/?>/, `<meta name="description" content="${escAttr(f.description)}" />`);
  else out = out.replace("</head>", `    <meta name="description" content="${escAttr(f.description)}" />\n  </head>`);
  out = out.replace("</head>", `    ${head}\n  </head>`);
  out = out.replace(/<div id="root"><\/div>/, `<div id="root">${f.html}</div>`);
  return out;
}

export function shelterPrerender(opts: { apiPort: number; timeoutMs?: number }): Plugin {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const api = `http://127.0.0.1:${opts.apiPort}`;

  async function proxyRootFile(req: IncomingMessage, res: ServerResponse, target: string): Promise<boolean> {
    const r = await fetchWithTimeout(`${api}${target}`, timeoutMs + 1500);
    if (!r || !r.ok) return false;
    let body: Buffer;
    try { body = Buffer.from(await r.arrayBuffer()); } catch { return false; }
    res.statusCode = 200;
    res.setHeader("content-type", r.headers.get("content-type") ?? "text/plain; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=300");
    res.setHeader("x-shelter-source", target);
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, getIndex: () => Promise<string>, publicDir: string): Promise<boolean> {
    const pathname = new URL(req.url ?? "/", "http://local").pathname.replace(/\/+$/, "") || "/";
    const rootTarget = ROOT_FILES[pathname];
    if (rootTarget && (req.method === "GET" || req.method === "HEAD")) {
      if (await proxyRootFile(req, res, rootTarget)) return true;
      const fallback = staticDiscovery(pathname, publicDir);
      if (fallback) {
        res.statusCode = 200;
        res.setHeader("content-type", fallback.type);
        res.setHeader("cache-control", "public, max-age=60");
        res.setHeader("x-shelter-source", "static-fallback");
        res.setHeader("warning", '110 shelter "Static discovery; live status unverified"');
        res.end(req.method === "HEAD" ? undefined : fallback.body);
        return true;
      }
      res.statusCode = 503;
      res.setHeader("content-type", "application/problem+json");
      res.setHeader("cache-control", "no-store");
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ title: "Discovery temporarily unavailable", status: 503, detail: "Retry later; this document is not an HTML app shell." }));
      return true;
    }
    if (pathname.startsWith("/.well-known/") || /^\/[a-z0-9._-]+\.(json|xml|md|txt)$/i.test(pathname)) {
      let exists = false;
      try { exists = statSync(resolve(publicDir, pathname.slice(1))).isFile(); } catch { /* missing discovery file */ }
      if (!exists) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/problem+json");
        res.end(JSON.stringify({ title: "No such discovery document", status: 404 }));
        return true;
      }
      return false;
    }
    const path = wantsPrerender(req);
    if (!path) return false;
    const r = await fetchWithTimeout(`${api}/api/shelter/prerender?path=${encodeURIComponent(path)}`, timeoutMs);
    let f: Fragment;
    let fallback = false;
    try {
      if (!r?.ok) throw new Error("Prerender unavailable");
      f = (await r.json()) as Fragment;
    } catch {
      f = outageFragment(path);
      fallback = true;
    }
    const html = injectFragment(await getIndex(), f);
    res.statusCode = fallback && f.status !== 200 ? 503 : f.status === 404 ? 404 : 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", f.status === 401 ? "no-store" : "public, max-age=60");
    if (f.status !== 200) res.setHeader("x-robots-tag", "noindex, nofollow");
    if (fallback) { res.setHeader("x-shelter-source", "static-fallback"); res.setHeader("retry-after", "30"); }
    res.setHeader("x-shelter-prerender", String(f.status));
    res.end(req.method === "HEAD" ? undefined : html);
    return true;
  }

  return {
    name: "shelter-prerender",
    configureServer(server: ViteDevServer) {
      const indexPath = resolve(server.config.root, "index.html");
      server.middlewares.use((req, res, next) => {
        const getIndex = async () => server.transformIndexHtml(req.url ?? "/", readFileSync(indexPath, "utf8"), req.originalUrl);
        handle(req, res, getIndex, resolve(server.config.root, "public")).then((done) => (done ? undefined : next())).catch(() => next());
      });
    },
    configurePreviewServer(server: PreviewServer) {
      const indexPath = resolve(server.config.root, server.config.build.outDir, "index.html");
      let cached: { mtime: number; html: string } | null = null;
      const getIndex = async () => {
        const mtime = statSync(indexPath).mtimeMs;
        if (!cached || cached.mtime !== mtime) cached = { mtime, html: readFileSync(indexPath, "utf8") };
        return cached.html;
      };
      server.middlewares.use((req, res, next) => {
        handle(req, res, getIndex, resolve(server.config.root, "public")).then((done) => (done ? undefined : next())).catch(() => next());
      });
    },
  };
}
