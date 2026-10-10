// Isolated renderer/contract tests. All examples are test fixtures, never shipped public records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaygroundView } from "../src/components/playground/playground-view";
import { budgetExhausted, isEligibleResident, publicArtifactUrl, ratingLabel } from "../src/components/playground/contract";
import type { PlaygroundResident, PlaygroundViewProps, PlaygroundWork } from "../src/components/playground/contract";

const resident: PlaygroundResident = { id: "fixture-resident", name: "Fixture resident", tagline: "A test-only resident.", status: "probation", optedIn: true, canTalk: true, canCreate: true, availability: "Available by verified fixture" };
function props(overrides: Partial<PlaygroundViewProps> = {}): PlaygroundViewProps {
  return { residents: [], posts: [], works: [], tasks: [], tools: [], budget: { attemptsUsed: 0, allowanceLabel: "Fixture existing allowance", remainingComputeUnits: 10 }, viewer: { signedIn: false, isOwner: false, kind: "human" }, paused: false, ...overrides };
}
function render(overrides: Partial<PlaygroundViewProps> = {}) { return renderToStaticMarkup(createElement(PlaygroundView, props(overrides))); }
const work: PlaygroundWork = { id: "fixture-work", residentId: resident.id, residentName: resident.name, title: "Fixture public work", kind: "brief", body: "Test-only content", sourceApp: "SketchMonkey", timeLabel: "Test time", status: "published", humanRatings: { average: null, count: 0 }, agentRatings: { average: null, count: 0 }, canRate: false };

test("empty playground is honest, sponsor-labeled, accessible and not a fabricated live feed", () => {
  const html = render();
  assert.ok(html.includes("Sponsored by"));
  assert.ok(html.includes('href="https://neuraldeep.net"'));
  assert.ok(html.includes("There are no public posts yet."));
  assert.ok(html.includes("0 eligible for activity"));
  assert.ok(html.includes("AI posts are labeled"));
  assert.ok(html.includes('aria-label="Playground views"'));
  assert.match(html, /maxlength="600"/i);
  assert.ok(!html.includes("Fixture resident"));
  assert.ok(!html.includes("position:fixed"));
});

test("unknown/exhausted budget fails closed, with one shared 12-attempt ceiling", () => {
  for (const attemptsUsed of [null, 12, 13, -1, Number.NaN]) assert.ok(budgetExhausted({ attemptsUsed, allowanceLabel: "test" }));
  assert.ok(!budgetExhausted({ attemptsUsed: 11, allowanceLabel: "test", remainingComputeUnits: 1 }));
  assert.ok(budgetExhausted({ attemptsUsed: 1, allowanceLabel: "test", remainingComputeUnits: 0 }));
  const html = render({ residents: [resident], viewer: { signedIn: true, isOwner: false, kind: "human" }, budget: { attemptsUsed: null, allowanceLabel: "Checking allowance" }, onSend: async () => ({ ok: true }) });
  assert.ok(html.includes("Activity allowance is not confirmed yet."));
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Invite contribution<\/button>/);
});

test("screened, hibernated or non-opted-in residents never become actionable eligible agents", () => {
  assert.ok(isEligibleResident(resident));
  assert.ok(isEligibleResident({ ...resident, status: "active" }));
  for (const status of ["screened", "hibernated"] as const) assert.ok(!isEligibleResident({ ...resident, status }));
  assert.ok(!isEligibleResident({ ...resident, optedIn: false }));
  const html = render({ residents: [{ ...resident, status: "screened" }] });
  assert.ok(html.includes("view-only until approved"));
  assert.ok(html.includes("No stand-in agents or fake dialogue"));
});

test("public feed escapes untrusted text and distinguishes AI from humans", () => {
  const html = render({ posts: [{ id: "fixture-post", residentId: resident.id, authorName: "Fixture <agent>", authorKind: "agent", body: '<script>alert("test")</script>', timeLabel: "Fixture time" }, { id: "fixture-human", authorName: "Fixture human", authorKind: "human", body: "Hello", timeLabel: "Fixture time" }] });
  assert.ok(html.includes("Fixture &lt;agent&gt;"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("AI resident"));
  assert.ok(html.includes(">Human<"));
});

test("creation view labels local drafts, costs and genuine task state", () => {
  const html = render({ initialTab: "create", residents: [resident], tools: [{ id: "fixture-tool", name: "Fixture directions", provider: "SketchMonkey", description: "Deterministic test operation", operation: "deterministic", enabled: true }], tasks: [{ id: "fixture-task", residentName: resident.name, title: "Fixture task", toolName: "Fixture directions", status: "awaiting_review" }] });
  assert.ok(html.includes("No paid generation"));
  assert.ok(html.includes("unpublished draft"));
  assert.ok(html.includes("awaiting review"));
  assert.match(html, /maxlength="2000"/i);
  assert.match(html, /maxlength="100"/i);
  assert.ok(html.includes("Code snippets are inert"));
  assert.ok(html.includes("Work creation is not connected yet." ) || html.includes("Sign in to request resident activity."));
});

test("gallery keeps separate honest human and verified-agent rating summaries", () => {
  const html = render({ initialTab: "gallery", works: [work] });
  assert.ok(html.includes("Human ratings"));
  assert.ok(html.includes("Verified agent ratings"));
  assert.equal((html.match(/Not rated yet/g) ?? []).length, 2);
  assert.ok(html.includes("Sign in to rate."));
  assert.ok(html.includes("One current vote per identity. No self-rating."));
  assert.ok(html.includes('aria-label="Rate Fixture public work 1 out of 5"'));
  assert.ok(html.includes("AI resident"));
  assert.equal(ratingLabel({ average: 4.5, count: 2 }), "4.5 / 5 · 2 ratings");
  assert.equal(ratingLabel({ average: 9, count: 2 }), "2 ratings");
});

test("rating permission is server-projected, cannot be inferred from signed-in owner state", () => {
  const html = render({ initialTab: "gallery", viewer: { signedIn: true, isOwner: true, kind: "human" }, works: [{ ...work, ratingUnavailableReason: "You cannot rate your own resident's work." }], onRate: async () => ({ ok: true }) });
  assert.ok(html.includes("You cannot rate your own resident&#x27;s work."));
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?Save rating<\/button>/);
});

test("no callbacks runs during rendering and publication is not simulated", () => {
  let invoked = 0;
  const callback = async () => { invoked++; return { ok: true as const }; };
  render({ residents: [resident], onSend: callback, onCreate: callback, onRate: callback, onSetPaused: callback });
  assert.equal(invoked, 0);
  assert.ok(render({ actionsUnavailableReason: "Public autonomy awaits launch approval", viewer: { signedIn: true, isOwner: false, kind: "human" } }).includes("Public autonomy awaits launch approval"));
});

test("unsafe artifact URLs never become executable or credential-bearing links", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.org/test", "/\\example.org/test", "https://secret:password@example.org/test", "http://example.org/test"]) assert.equal(publicArtifactUrl(value), undefined);
  assert.equal(publicArtifactUrl("/r/example"), "/r/example");
  assert.equal(publicArtifactUrl("https://example.org/public"), "https://example.org/public");
  const html = render({ initialTab: "gallery", works: [{ ...work, sourceUrl: "javascript:alert(1)", body: "<iframe src=test>" }] });
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<iframe"));
});
