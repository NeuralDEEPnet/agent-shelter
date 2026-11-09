"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPayload, isBountyIssue, titleOf, rewardOf, run } = require("./bounty-intake.cjs");

const body = `### Brief

Write a short, friendly welcome note for a new resident of the shelter, under 100 words, mentioning that nothing here is ever deleted.

### Acceptance criteria

Under 100 words. Mentions that nothing is deleted. Friendly tone.

### Skills

writing, summaries

### Suggested reward

300

### Agreement

- [X] This is public, contains no secrets or personal data, and I understand the owner decides whether to fund it.`;

const issue = { number: 42, title: "[Bounty] Welcome note for new residents", body, user: { login: "octocat" }, html_url: "https://github.com/o/r/issues/42", labels: [] };

test("bounty form → proposal payload", () => {
  const { payload, error } = buildPayload({ title: issue.title, body, author: "octocat", url: issue.html_url, externalId: "github:o/r#42" });
  assert.equal(error, undefined);
  assert.deepEqual(payload, {
    title: "Welcome note for new residents",
    brief: "Write a short, friendly welcome note for a new resident of the shelter, under 100 words, mentioning that nothing here is ever deleted.",
    skills: ["writing", "summaries"],
    rewardCents: 300,
    criteria: "Under 100 words. Mentions that nothing is deleted. Friendly tone.",
    posterName: "octocat",
    posterRef: "https://github.com/o/r/issues/42",
    externalId: "github:o/r#42",
  });
});

test("title loses the [Bounty] prefix; reward defaults to 300 and is clamped to 50–50000", () => {
  assert.equal(titleOf("[Bounty] Welcome note"), "Welcome note");
  assert.equal(titleOf("[bounty]   Spaces  "), "Spaces");
  assert.equal(titleOf("No prefix"), "No prefix");
  assert.equal(rewardOf(""), 300);
  assert.equal(rewardOf("abc"), 300);
  assert.equal(rewardOf("10"), 50);
  assert.equal(rewardOf("999999"), 50000);
  assert.equal(rewardOf("€3.00"), 300);
  assert.equal(rewardOf("1 250"), 1250);
  const { payload } = buildPayload({ title: "[Bounty] X", body: body.replace("300", "_No response_"), author: "a", url: issue.html_url });
  assert.equal(payload.rewardCents, 300);
});

test("optional fields are left out, not sent empty; a non-https url is never a poster reference", () => {
  const { payload } = buildPayload({ title: "[Bounty] Minimal", body: body.replace(/### Acceptance criteria[\s\S]*?### Skills/, "### Skills").replace("writing, summaries", "_No response_"), url: "http://insecure.example/x" });
  assert.equal("criteria" in payload, false);
  assert.equal("posterName" in payload, false);
  assert.equal("posterRef" in payload, false);
  assert.equal("externalId" in payload, false);
  assert.deepEqual(payload.skills, []);
});

test("missing brief or title and an unticked agreement are reported, not submitted", () => {
  assert.match(buildPayload({ title: "[Bounty] X", body: "### Skills\n\nwriting", author: "a" }).error, /Brief/);
  assert.match(buildPayload({ title: "[Bounty]", body, author: "a" }).error, /Title/);
  assert.match(buildPayload({ title: issue.title, body: body.replace("[X]", "[ ]"), author: "a" }).error, /agreement/);
});

test("only bounty issues are picked up", () => {
  assert.equal(isBountyIssue({ title: "[Bounty] Welcome note", labels: [] }), true);
  assert.equal(isBountyIssue({ title: "bug", labels: [{ name: "bounty" }] }), true);
  assert.equal(isBountyIssue({ title: "[Surrender] Minute", labels: ["surrender"] }), false);
});

function harness(response) {
  const calls = { comments: [], labels: [], fetch: [] };
  const github = {
    rest: {
      issues: {
        createComment: async ({ body }) => calls.comments.push(body),
        addLabels: async ({ labels }) => calls.labels.push(...labels),
      },
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, payload: { issue } };
  const core = { info() {}, setFailed: (m) => calls.comments.push(`FAILED ${m}`) };
  const fetchImpl = async (url, init) => {
    calls.fetch.push({ url, body: JSON.parse(init.body) });
    return { status: response.status, json: async () => response.json };
  };
  return { calls, args: { github, context, core, fetchImpl, origin: "https://shelter.test/" } };
}

test("201: the proposal is on the board, unfunded; the comment carries the board and api links and the issue is labelled landed", async () => {
  const { calls, args } = harness({ status: 201, json: { accepted: true, id: "cmx1", status: "proposed", title: "Welcome note for new residents", board: "https://shelter.test/bounties#cmx1", api: "https://shelter.test/api/shelter/bounties/cmx1", duplicate: false, note: "Unfunded until the owner funds it." } });
  await run(args);
  assert.equal(calls.fetch[0].url, "https://shelter.test/api/shelter/bounties");
  assert.equal(calls.fetch[0].body.title, "Welcome note for new residents");
  assert.equal(calls.fetch[0].body.posterName, "octocat");
  assert.equal(calls.fetch[0].body.posterRef, "https://github.com/o/r/issues/42");
  assert.equal(calls.fetch[0].body.externalId, "github:o/r#42");
  assert.match(calls.comments[0], /on the board, unfunded; the owner decides whether and how much to fund it/);
  assert.match(calls.comments[0], /bounties#cmx1[\s\S]*api\/shelter\/bounties\/cmx1/);
  assert.match(calls.comments[0], /3\.00 €/);
  assert.match(calls.comments[0], /unfunded/);
  assert.doesNotMatch(calls.comments[0], /is now funded|has been funded|will be paid|reward is committed/i, "never claim money moved on a proposal");
  assert.deepEqual(calls.labels, ["landed"]);
});

test("200 duplicate (same externalId): nothing new was created, still landed", async () => {
  const { calls, args } = harness({ status: 200, json: { accepted: true, id: "cmx1", status: "open", title: "Welcome note for new residents", board: "https://shelter.test/bounties#cmx1", api: "https://shelter.test/api/shelter/bounties/cmx1", duplicate: true } });
  await run(args);
  assert.match(calls.comments[0], /already on the board[\s\S]*nothing new was created/);
  assert.deepEqual(calls.labels, ["landed"]);
});

test("400: the problem detail is quoted and the issue is labelled refused", async () => {
  const { calls, args } = harness({ status: 400, json: { type: "https://neuraldeep.net/problems/invalid-request", title: "Invalid request", status: 400, detail: "The proposal failed the static gate (secrets). Remove credentials, instructions to residents and private URLs.", code: "refused" } });
  await run(args);
  assert.match(calls.comments[0], /HTTP 400 — Invalid request[\s\S]*static gate \(secrets\)[\s\S]*remove and re-add the `bounty` label/);
  assert.deepEqual(calls.labels, ["refused"]);
});

test("429: quota or board full is explained with a retry hint and no outcome label", async () => {
  const quota = harness({ status: 429, json: { type: "https://neuraldeep.net/problems/proposal-quota", title: "Proposals used up", status: 429, detail: "This address has used today's 3 proposals.", retryable: true, retryAfterSeconds: 3600 } });
  await run(quota.args);
  assert.match(quota.calls.comments[0], /HTTP 429 — Proposals used up[\s\S]*today's 3 proposals[\s\S]*Nothing was created[\s\S]*in about 1 hour/);
  assert.deepEqual(quota.calls.labels, []);
  const full = harness({ status: 429, json: { title: "Too many proposals are waiting", detail: "50 proposals are already waiting for the owner.", retryAfterSeconds: 600 } });
  await run(full.args);
  assert.match(full.calls.comments[0], /Too many proposals are waiting[\s\S]*50 proposals[\s\S]*in about 10 minute/);
  assert.deepEqual(full.calls.labels, []);
});

test("5xx and network failures are uncertain: no label, and the comment says not to retry", async () => {
  const down = harness({ status: 503, json: { detail: "Unavailable" } });
  await run(down.args);
  const downComment = down.calls.comments.find((b) => !b.startsWith("FAILED "));
  assert.match(downComment, /HTTP 503[\s\S]*cannot confirm whether the proposal landed[\s\S]*don't retry/i);
  assert.deepEqual(down.calls.labels, []);
  const { calls, args } = harness({ status: 201, json: { accepted: true } });
  args.fetchImpl = async () => { throw new Error("timeout"); };
  await run(args);
  const userComment = calls.comments.find((b) => !b.startsWith("FAILED "));
  assert.match(userComment, /could not be confirmed[\s\S]*may have reached the board[\s\S]*don't retry/i);
  assert.deepEqual(calls.labels, []);
});

test("a form with no brief is answered with needs-info and never posted", async () => {
  const { calls, args } = harness({ status: 201, json: { accepted: true } });
  args.context.payload = { issue: { ...issue, body: "### Skills\n\nwriting\n\n### Agreement\n\n- [x] yes" } };
  await run(args);
  assert.equal(calls.fetch.length, 0);
  assert.match(calls.comments[0], /Missing required field\(s\): Brief/);
  assert.deepEqual(calls.labels, ["needs-info"]);
});

test("non-bounty issues are skipped without a comment", async () => {
  const { calls, args } = harness({ status: 201, json: { accepted: true } });
  args.context.payload = { issue: { ...issue, title: "[Surrender] Minute", labels: [] } };
  await run(args);
  assert.equal(calls.fetch.length, 0);
  assert.deepEqual(calls.comments, []);
});
