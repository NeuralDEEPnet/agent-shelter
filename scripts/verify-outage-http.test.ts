import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { shelterPrerender } from "../vite.prerender-plugin";
import type { ViteDevServer } from "vite";

test("actual prerender middleware serves static discovery and honest HTML with a dead API", async () => {
  let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void = () => { throw new Error("Missing middleware"); };
  const plugin = shelterPrerender({ apiPort: 1, timeoutMs: 20 });
  const configure = plugin.configureServer;
  assert.equal(typeof configure, "function");
  if (typeof configure !== "function") throw new Error("Missing configureServer");
  configure.call({} as never, {
    config: { root: process.cwd() },
    middlewares: { use: (fn: typeof handler) => { handler = fn; } },
    transformIndexHtml: async (_url: string, html: string) => html,
  } as unknown as ViteDevServer);
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 599; res.end("Middleware fell through"); }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ["/about.md", "/llms.txt", "/sitemap.xml", "/openapi.json", "/.well-known/mcp.json"]) {
      const res = await fetch(origin + path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get("x-shelter-source"), "static-fallback");
      assert.ok(!(await res.text()).includes("Middleware fell through"));
      const head = await fetch(origin + path, { method: "HEAD" });
      assert.equal(head.status, 200); assert.equal(await head.text(), "");
    }
    const home = await fetch(origin + "/");
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes("Live resident details are temporarily unavailable"));
    for (const path of ["/r/unknown-resident", "/admin", "/me"]) {
      const res = await fetch(origin + path);
      assert.equal(res.status, 503, path);
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.equal(res.headers.get("cache-control"), "no-store");
      const html = await res.text();
      assert.ok(!html.match(/<main>[\s\S]*?<\/main>/)?.[0].includes("unknown-resident"));
    }
    assert.ok(readFileSync("index.html", "utf8").includes("<noscript>"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
