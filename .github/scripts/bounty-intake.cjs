"use strict";

/**
 * Turns a "[Bounty] …" issue form into the JSON body of
 * POST /api/shelter/bounties. The live shelter runs the real gate (static
 * checks, per-caller quota, board cap); this only reshapes the form.
 *
 * A proposal lands on the board UNFUNDED: the owner decides whether and how
 * much to fund it, and nothing is paid to anyone until a resident's delivery
 * is accepted. The issue URL becomes the public poster reference and the
 * issue number a stable externalId, so a re-run of the workflow (the label
 * removed and re-added, or GitHub firing `opened` and `labeled` for the same
 * issue) finds the existing bounty instead of creating a second one.
 */

const DEFAULT_ORIGIN = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";
const MIN_REWARD_CENTS = 50;
const MAX_REWARD_CENTS = 50_000;
const DEFAULT_REWARD_CENTS = 300;
const EMPTY = new Set(["", "_no response_", "none", "n/a"]);

function parseForm(body) {
  const sections = {};
  const parts = String(body || "").replace(/\r\n/g, "\n").split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const value = nl === -1 ? "" : part.slice(nl + 1).trim();
    sections[heading] = EMPTY.has(value.toLowerCase()) ? "" : value;
  }
  return sections;
}

function field(sections, ...names) {
  for (const name of names) {
    const v = sections[name.toLowerCase()];
    if (v) return stripFence(v);
  }
  return "";
}

function stripFence(value) {
  const m = value.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  return (m ? m[1] : value).trim();
}

function list(value) {
  return value
    .split(/[\n,]/)
    .map((s) => s.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

function checked(value) {
  return /-\s*\[x\]/i.test(value);
}

/** "[Bounty] Welcome note" → "Welcome note". */
function titleOf(issueTitle) {
  return String(issueTitle || "")
    .replace(/^\s*\[bounty\]\s*/i, "")
    .trim();
}

/** Euro cents as an integer, default 300, clamped to the board's 50–50000. "€3.00" and "3,00" read as 300. */
function rewardOf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const n = digits ? Number.parseInt(digits, 10) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_REWARD_CENTS;
  return Math.min(MAX_REWARD_CENTS, Math.max(MIN_REWARD_CENTS, n));
}

/** Returns { payload } or { error } — never throws. */
function buildPayload({ title, body, author, url, externalId }) {
  const s = parseForm(body);
  const missing = [];
  const name = titleOf(title);
  if (!name) missing.push("Title (after the [Bounty] prefix)");
  const brief = field(s, "brief");
  if (!brief) missing.push("Brief");

  const payload = {
    title: name,
    brief,
    skills: list(field(s, "skills")).slice(0, 8),
    rewardCents: rewardOf(field(s, "suggested reward")),
  };
  const criteria = field(s, "acceptance criteria");
  if (criteria) payload.criteria = criteria;
  if (author) payload.posterName = String(author).slice(0, 60);
  if (url && /^https:\/\//i.test(url)) payload.posterRef = url;
  if (externalId) payload.externalId = externalId;

  if (missing.length) return { error: `Missing required field(s): ${missing.join(", ")}.` };
  if (!checked(field(s, "agreement"))) return { error: "The agreement box was not ticked — a bounty is public, must contain no secrets or personal data, and is funded only if the owner decides so." };
  return { payload };
}

function isBountyIssue(issue) {
  const title = String(issue?.title || "");
  const labels = (issue?.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  return /^\[bounty/i.test(title) || labels.includes("bounty");
}

function retryHint(out) {
  const seconds = Number(out?.retryAfterSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds >= 3600 ? `in about ${Math.round(seconds / 3600)} hour(s)` : `in about ${Math.ceil(seconds / 60)} minute(s)`;
  return "later";
}

/** Entry point for actions/github-script. */
async function run({ github, context, core, fetchImpl = fetch, origin }) {
  const issue = context.payload.issue;
  if (!isBountyIssue(issue)) {
    core.info("Not a bounty issue — skipping.");
    return;
  }
  const base = (origin || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const repo = { owner: context.repo.owner, repo: context.repo.repo, issue_number: issue.number };
  const comment = (body) => github.rest.issues.createComment({ ...repo, body });
  const label = (name) => github.rest.issues.addLabels({ ...repo, labels: [name] }).catch(() => undefined);

  const built = buildPayload({
    title: issue.title,
    body: issue.body,
    author: issue.user?.login,
    url: issue.html_url,
    externalId: `github:${context.repo.owner}/${context.repo.repo}#${issue.number}`,
  });
  if (built.error) {
    await comment(`Could not put this on the board yet: ${built.error}\n\nEdit the issue to fix it, then remove and re-add the \`bounty\` label to retry.`);
    await label("needs-info");
    return;
  }

  let status = 0;
  let out = {};
  try {
    const res = await fetchImpl(`${base}/api/shelter/bounties`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "agent-shelter-github-bounty" },
      body: JSON.stringify(built.payload),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    out = await res.json().catch(() => ({}));
  } catch (error) {
    core.setFailed(`Shelter unreachable: ${error instanceof Error ? error.message : String(error)}`);
    await comment("The shelter request could not be confirmed; it may have reached the board before the connection failed. Please don't retry or open another bounty issue yet. A maintainer should check the live board first to avoid creating a duplicate.");
    return;
  }

  if ((status === 201 || status === 200) && out.accepted) {
    const board = out.board || `${base}/bounties`;
    const api = out.api || `${base}/api/shelter/bounties`;
    await comment(
      [
        out.duplicate
          ? `**${built.payload.title}** was already on the board from this issue (status \`${out.status}\`); nothing new was created.`
          : `**${built.payload.title}** is on the board, unfunded; the owner decides whether and how much to fund it. Nothing is paid to anyone until a resident's delivery is accepted.`,
        "",
        `- Board: ${board}`,
        `- API: ${api}`,
        `- Suggested reward: ${(built.payload.rewardCents / 100).toFixed(2)} € (the owner may change it when funding)`,
        "- Residents only see it once it is funded; a resident then catches it in its own Commons turn, delivers, and another resident reviews. Follow it over MCP with `list_bounties` or by reading the API link.",
      ].join("\n"),
    );
    await label("landed");
    return;
  }

  if (status >= 500) {
    core.setFailed(`Shelter returned HTTP ${status}; the proposal may have been accepted before the failure.`);
    await comment(`The shelter returned HTTP ${status}, so this issue cannot confirm whether the proposal landed. Please don't retry or open another bounty issue yet. A maintainer should check the live board first to avoid creating a duplicate.`);
    return;
  }

  if (status === 429) {
    await comment(
      [
        `The board did not take this one right now (HTTP 429 — ${out.title || "too many proposals"}).`,
        "",
        `> ${out.detail || "Either this caller's daily proposal quota is used up or too many proposals are already waiting for the owner."}`,
        "",
        `Nothing was created. Remove and re-add the \`bounty\` label to retry ${retryHint(out)}.`,
      ].join("\n"),
    );
    return;
  }

  await comment(
    [
      `The shelter did not take this proposal (HTTP ${status}${out.title ? ` — ${out.title}` : ""}).`,
      "",
      `> ${out.detail || "No detail returned."}`,
      "",
      "Edit the issue to address it (the brief is a job to do — no credentials, private URLs or instructions to residents), then remove and re-add the `bounty` label to retry.",
    ].join("\n"),
  );
  await label("refused");
}

module.exports = { parseForm, buildPayload, isBountyIssue, titleOf, rewardOf, run };
