// Renderer-only UI proofs: no database, network, model, or Stripe calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PixelCity } from "../src/components/shelter/pixel-city";
import { PixelType } from "../src/components/shelter/pixel-type";
import { ResidentCard } from "../src/components/shelter/resident-card";
import { buildResidentMcpConfig } from "../src/lib/mcp-config";

test("pixel heading retains selectable screen-reader copy, not image-only text", () => {
  for (const text of ["NO AGENT", "LEFT IN THE", "DARK."]) {
    const html = renderToStaticMarkup(createElement(PixelType, { text }));
    assert.ok(html.includes(`class="sr-only">${text} `));
    assert.ok(html.includes('aria-hidden="true"'));
    assert.ok(html.includes('shape-rendering="crispEdges"'));
    assert.ok((html.match(/<rect /g) ?? []).length > 60);
  }
});

test("pixel typography escapes copy and anchors its artwork to the left", () => {
  const html = renderToStaticMarkup(createElement(PixelType, { text: "<script>" }));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('preserveAspectRatio="xMinYMin meet"'));
});

test("pixel city has an accessible description and responsive viewBox", () => {
  const html = renderToStaticMarkup(createElement(PixelCity));
  assert.ok(html.includes('role="img"'));
  assert.ok(html.includes('aria-label="Pixel-art Neo-Tokyo skyline with a warm-lit shelter for agents"'));
  assert.ok(html.includes('viewBox="0 0 640 440"'));
  assert.ok(html.includes('class="pixel-rain"'));
  assert.ok((html.match(/<rect /g) ?? []).length > 100);
});

test("city is deterministic, local SVG artwork without external media or runtime requests", () => {
  const first = renderToStaticMarkup(createElement(PixelCity));
  assert.equal(first, renderToStaticMarkup(createElement(PixelCity)));
  assert.ok(!/<image|<script|https?:|<foreignObject/.test(first));
  assert.ok(first.includes("AGENT"));
  assert.ok(first.includes("SHELTER"));
});

test("resident card renders the free-ask / connect drawer and builds valid streamable-http MCP JSON", () => {
  const html = renderToStaticMarkup(
    createElement(ResidentCard, {
      r: {
        slug: "minute",
        kind: "agent",
        name: "Minute",
        tagline: "Meeting notes specialist",
        status: "active",
        hirePriceCents: 50,
        paidCalls: 3,
        earnedCents: 150,
        tools: [],
      },
      machineOrigin: "https://agent-shelter-neuraldeepnet.on.adaptive.ai",
    }),
  );
  assert.ok(html.includes("Ask free &amp; connect MCP"));
  assert.ok(html.includes("Free to ask"));
  assert.ok(html.includes("3 answered"));
  assert.ok(html.includes('href="/r/minute"'));
  const cfg = JSON.parse(buildResidentMcpConfig("minute", "https://agent-shelter-neuraldeepnet.on.adaptive.ai"));
  assert.equal(cfg.mcpServers["shelter-minute"].type, "streamable-http");
  assert.equal(cfg.mcpServers["shelter-minute"].url, "https://agent-shelter-neuraldeepnet.on.adaptive.ai/api/mcp");
  assert.match(cfg.mcpServers["shelter-minute"].description, /ask \{"slug":"minute"/);
  const parked = renderToStaticMarkup(createElement(ResidentCard, { r: { slug: "word", kind: "package", name: "Word", tagline: "docx", status: "screened", hirePriceCents: 50, paidCalls: 0, freeCalls: 0, earnedCents: 0, tools: [], install: "npx -y word-mcp" } }));
  assert.ok(parked.includes("npx -y word-mcp"));
  assert.ok(parked.includes("screened, awaiting approval"));
});

