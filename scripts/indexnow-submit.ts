/**
 * IndexNow + sitemap ping for the AI Agent Shelter.
 *
 * ChatGPT search and Copilot ride the Bing index; IndexNow (api.indexnow.org) is the fastest way
 * into it and needs no webmaster account — only a key file hosted at the root of the host.
 * Google deprecated the sitemap ping endpoint in 2023; we still print (and try) it, ignoring failures.
 *
 *   npm run indexnow            # submit
 *   npm run indexnow -- --dry-run   # print the URL list, POST nothing
 *
 * No AI calls, no dependencies beyond Node's fetch.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGIN = process.env.SHELTER_ORIGIN ?? "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
const HOST = new URL(ORIGIN).host;
const PUBLIC_DIR = resolve(import.meta.dirname, "..", "public");
const DRY = process.argv.includes("--dry-run");

function findKey(): { key: string; keyLocation: string } {
  const files = readdirSync(PUBLIC_DIR).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (files.length !== 1) throw new Error(`expected exactly one IndexNow key file (32 hex chars .txt) in public/, found ${files.length}`);
  const key = readFileSync(resolve(PUBLIC_DIR, files[0]), "utf8").trim();
  if (key !== files[0].replace(/\.txt$/, "")) throw new Error(`key file ${files[0]} must contain its own name`);
  return { key, keyLocation: `${ORIGIN}/${files[0]}` };
}

async function sitemapUrls(): Promise<string[]> {
  const res = await fetch(`${ORIGIN}/api/shelter/sitemap.xml`, { headers: { accept: "application/xml" } });
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  const { key, keyLocation } = findKey();
  const fromSitemap = await sitemapUrls();
  const extras = ["/", "/about.md", "/whitepaper.md", "/robots.txt", "/.well-known/mcp.json", "/.well-known/agent.json", "/.well-known/ai-plugin.json", "/api/mpp/catalog", "/api/mpp/openapi.json", "/api/shelter/llms.txt"].map((p) => `${ORIGIN}${p}`);
  // IndexNow only accepts URLs on the key's host; hash URLs are not real pages.
  const urlList = [...new Set([...extras, ...fromSitemap])].filter((u) => new URL(u).host === HOST && !u.includes("#"));
  const skipped = fromSitemap.filter((u) => !urlList.includes(u));

  console.log(`host: ${HOST}\nkey: ${keyLocation}\nurls (${urlList.length}):`);
  for (const u of urlList) console.log(`  ${u}`);
  if (skipped.length) console.log(`skipped (other host or hash URL): ${skipped.join(", ")}`);

  const sitemapPing = `https://www.google.com/ping?sitemap=${encodeURIComponent(`${ORIGIN}/sitemap.xml`)}`;
  console.log(`google sitemap ping (deprecated, best effort): ${sitemapPing}`);
  if (DRY) return console.log("--dry-run: nothing submitted");

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList }),
  });
  // 200 = ok, 202 = accepted (key validation pending), 400 bad format, 403 key mismatch, 422 URL not on host, 429 spam.
  console.log(`indexnow: HTTP ${res.status} ${res.statusText}${res.status >= 400 ? ` — ${(await res.text()).slice(0, 300)}` : ""}`);

  try {
    const g = await fetch(sitemapPing, { method: "GET" });
    console.log(`google ping: HTTP ${g.status} (ignored)`);
  } catch (e) {
    console.log(`google ping failed (ignored): ${e instanceof Error ? e.message : String(e)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
