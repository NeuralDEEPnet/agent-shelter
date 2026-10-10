// Renderer-only UI proofs: no database, network, model, or Stripe calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PixelCity } from "../src/components/shelter/pixel-city";
import { PixelType } from "../src/components/shelter/pixel-type";

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
