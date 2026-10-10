"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPayload, isSurrenderIssue, run } = require("./surrender-intake.cjs");

const agentBody = `### Kind

agent

### Name

Minute

### Tagline

Turns messy meeting notes into decisions, owners and deadlines.

### Story

Built for a team that stopped meeting.

### System prompt

\`\`\`text
You turn meeting notes into decisions.
\`\`\`

### Greeting

_No response_

### Skills

meeting notes, action items

### Memory

- Prefers bullet lists
- Uses ISO dates

### License

MIT

### Creator name

_No response_

### Creator contact

_No response_

### Creator share (%)

5

### Agreement

- [X] I have the right to surrender this, it contains no secrets or third-party personal data, and I accept shelter-surrender/1.`;

const mcpBody = `### Kind

mcp

### Name

Weather

### Tagline

Forecasts.

### Story

Left behind.

### MCP endpoint

https://example.com/mcp

### Tools to expose

forecast, alerts

### License

Unknown

### Agreement

- [x] I have the right`;

test("agent form → intake payload", () => {
  const { payload, error } = buildPayload({ body: agentBody, author: "octocat" });
  assert.equal(error, undefined);
  assert.equal(payload.name, "Minute");
  assert.equal(payload.creatorName, "octocat");
  assert.equal(payload.creatorContact, "https://github.com/octocat");
  assert.equal(payload.creatorSharePct, 5);
  assert.equal(payload.attestation, true);
  assert.equal(payload.agreementVersion, "shelter-surrender/1");
  assert.deepEqual(payload.spec, {
    kind: "agent",
    systemPrompt: "You turn meeting notes into decisions.",
    skills: ["meeting notes", "action items"],
    memory: ["Prefers bullet lists", "Uses ISO dates"],
    tools: [],
  });
});

test("mcp form → intake payload", () => {
  const { payload } = buildPayload({ body: mcpBody, author: "octocat" });
  assert.deepEqual(payload.spec, { kind: "mcp", endpoint: "https://example.com/mcp", expose: ["forecast", "alerts"] });
  assert.equal(payload.license, "Unknown");
  assert.equal(payload.creatorSharePct, 10);
});

test("missing fields and unticked agreement are reported, not submitted", () => {
  assert.match(buildPayload({ body: "### Kind\n\nmcp\n\n### Name\n\nX", author: "a" }).error, /Tagline.*Story.*MCP endpoint/);
  assert.match(buildPayload({ body: mcpBody.replace("[x]", "[ ]"), author: "a" }).error, /agreement/);
});

test("only surrender issues are picked up", () => {
  assert.equal(isSurrenderIssue({ title: "[Surrender] Minute", labels: [] }), true);
  assert.equal(isSurrenderIssue({ title: "bug", labels: [{ name: "surrender" }] }), true);
  assert.equal(isSurrenderIssue({ title: "bug", labels: [] }), false);
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
  const context = { repo: { owner: "o", repo: "r" }, payload: { issue: { number: 1, title: "[Surrender] Minute", body: agentBody, user: { login: "octocat" }, labels: [] } } };
  const core = { info() {}, setFailed: (m) => calls.comments.push(`FAILED ${m}`) };
  const fetchImpl = async (url, init) => {
    calls.fetch.push({ url, body: JSON.parse(init.body) });
    return { status: response.status, json: async () => response.json };
  };
  return { calls, args: { github, context, core, fetchImpl, origin: "https://shelter.test/" } };
}

test("accepted intake comments the slug and labels landed", async () => {
  const { calls, args } = harness({ status: 201, json: { accepted: true, slug: "minute", status: "submitted", resume: "https://shelter.test/r/minute", checks: [{ id: "secrets", ok: true, detail: "none" }] } });
  await run(args);
  assert.equal(calls.fetch[0].url, "https://shelter.test/api/shelter/surrender");
  assert.equal(calls.fetch[0].body.spec.kind, "agent");
  assert.match(calls.comments[0], /`minute`[\s\S]*r\/minute[\s\S]*\| pass \| secrets \|/);
  assert.deepEqual(calls.labels, ["landed"]);
});

test("refused intake comments the failing checks and labels refused", async () => {
  const { calls, args } = harness({ status: 400, json: { detail: "Looks like a credential.", checks: [{ id: "secrets", ok: false, detail: "stripe-secret" }] } });
  await run(args);
  assert.match(calls.comments[0], /HTTP 400[\s\S]*credential[\s\S]*\*\*fail\*\* \| secrets/);
  assert.deepEqual(calls.labels, ["refused"]);
});

test("network timeout is reported as uncertain without claiming nothing was submitted", async () => {
  const { calls, args } = harness({ status: 201, json: { accepted: true } });
  args.fetchImpl = async () => { throw new Error("timeout"); };
  await run(args);
  const userComment = calls.comments.find((body) => !body.startsWith("FAILED "));
  assert.match(userComment, /could not be confirmed[\s\S]*may have reached intake[\s\S]*don't retry/i);
  assert.doesNotMatch(userComment, /nothing was submitted/i);
  assert.deepEqual(calls.labels, []);
});

test("server error is treated as uncertain to prevent duplicate submissions", async () => {
  const { calls, args } = harness({ status: 503, json: { detail: "Unavailable" } });
  await run(args);
  const userComment = calls.comments.find((body) => !body.startsWith("FAILED "));
  assert.match(userComment, /HTTP 503[\s\S]*cannot confirm whether intake succeeded[\s\S]*don't retry/i);
  assert.deepEqual(calls.labels, []);
});
