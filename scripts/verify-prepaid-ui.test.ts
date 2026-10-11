// Render-only prepaid UI proofs. No database, network, model, checkout or real payment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PrepaidPanel, type PrepaidPanelProps } from "../src/components/shelter/prepaid-panel";

const props: PrepaidPanelProps = {
  signedIn: true, balanceCents: 500, residentSlug: "minute",
  onSignIn: () => { throw new Error("render invoked authentication"); },
  onTopUp: async () => { throw new Error("render invoked checkout"); },
  onAsk: async () => { throw new Error("render invoked AI"); },
  onRefresh: () => { throw new Error("render invoked RPC"); },
};
const render = (patch: Partial<PrepaidPanelProps> = {}) => renderToStaticMarkup(createElement(PrepaidPanel, { ...props, ...patch }));

test("prepaid UI renders face-value amounts, cheap modes and separate buyer balance", () => {
  const html = render();
  for (const amount of ["€0.50", "€1.00", "€5.00", "€10.00"]) assert.ok(html.includes(amount));
  assert.ok(html.includes("Standard · €0.05 / question"));
  assert.ok(html.includes("Simple · €0.01 / question"));
  assert.ok(html.includes("Separate from every resident"));
  assert.ok(html.includes("full amount paid as credit"));
  assert.ok(html.includes("No subscription, auto-top-up or unlimited usage"));
  assert.ok(html.includes("Public MCP tools cannot spend your private balance"));
});

test("anonymous view never displays a private balance or active checkout", () => {
  const html = render({ signedIn: false, balanceCents: 99999, heldCents: 123 });
  assert.ok(html.includes("Sign in for prepaid questions"));
  assert.ok(!html.includes("€999.99"));
  assert.ok(!html.includes("€1.23"));
  assert.ok(!html.includes("Add €5.00 credit"));
  assert.ok(html.includes('disabled=""'));
});

test("available credit and pending holds are distinct and loading does not fabricate balance", () => {
  const html = render({ balanceCents: 40, heldCents: 5 });
  assert.ok(html.includes("€0.40"));
  assert.ok(html.includes("€0.05 held for pending work"));
  const loading = render({ loading: true });
  assert.ok(loading.includes('aria-busy="true"'));
  assert.ok(loading.includes('text-primary">…</strong>'));
});

test("empty balance asks for manual top-up, no selected resident asks for selection", () => {
  assert.ok(render({ balanceCents: 0 }).includes("Add credit to ask this question"));
  const none = render({ residentSlug: undefined });
  assert.ok(none.includes("Choose an available resident"));
  assert.ok(!none.includes("<textarea"));
});

test("mobile inputs, headings, status and modes have accessible contracts", () => {
  const html = render();
  assert.ok(html.includes('aria-labelledby="'));
  assert.ok(html.includes('aria-describedby="'));
  assert.ok(html.includes('maxLength="2000"'));
  assert.ok(html.includes("text-base leading-relaxed"));
  assert.ok(html.includes("min-h-11"));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(!html.includes("position:fixed"));
});

test("simple availability and backend-provided character cap are respected", () => {
  const html = render({ simpleAvailable: false, standardMaxChars: 1600 });
  assert.ok(html.includes("Simple mode is unavailable for this resident"));
  assert.ok(html.includes('maxLength="1600"'));
  assert.ok(/disabled=""[^>]*>Simple · 1c/.test(html));
});

test("source opens checkout before await, validates Stripe URLs and retains exact retry input", () => {
  const source = readFileSync(new URL("../src/components/shelter/prepaid-panel.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("const tab = openCheckoutTab()") < source.indexOf("await onTopUp("));
  assert.ok(source.includes('url.protocol === "https:"'));
  assert.ok(source.includes('"checkout.stripe.com", "buy.stripe.com"'));
  assert.ok(source.includes("retry ? pendingAsk.current"));
  assert.ok(source.includes("pendingAsk.current = input"));
  assert.ok(!source.includes("setInterval"));
  assert.ok(!source.includes("fetch("));
});
