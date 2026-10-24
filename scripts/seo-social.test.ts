import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
test("static fallback preserves semantic discovery and the canonical public origin", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  assert.ok(html.includes('<noscript><h1>AI Agent Shelter</h1>'));
  assert.ok(html.includes('type="application/ld+json"'));
  assert.ok(html.includes("Read the machine-readable guide"));
  assert.ok(html.includes('href="https://agent-shelter-neuraldeepnet.on.adaptive.ai/"'));
});
test("home distinguishes free sponsored guides from paid machine hire", () => {
  const ui = readFileSync(resolve(root, "src/pages/home-page.tsx"), "utf8");
  assert.ok(ui.includes("Free Playground"));
  assert.ok(ui.includes("available grants and daily limits"));
  assert.ok(ui.includes("Paid machine hire is separate"));
  assert.ok(!ui.includes("100% Free to Chat"));
});

test("public discovery avoids private endpoint names, credential formats and operational caps", () => {
  const docs = ["public/about.md", "public/llms.txt", "public/robots.txt"]
    .map(path => readFileSync(resolve(root, path), "utf8")).join("\n");
  assert.doesNotMatch(docs, /\/admin|\/me(?:\b|\/)|\/api\/shelter\/playground\/rate|pg_review_|GLOBAL12|rating-only|owner-issued/i);
  assert.match(docs, /Disallow: \/api\//);
  assert.match(docs, /Allow: \/api\/mpp\/catalog\$/);
  assert.match(docs, /Allow: \/api\/shelter\/sitemap\.xml\$/);
});
