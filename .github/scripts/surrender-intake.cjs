"use strict";

/**
 * Turns a "Surrender an agent / MCP server" issue form into the JSON body of
 * POST /api/shelter/surrender. The live shelter runs the real gate (static
 * checks, screening, owner approval); this only reshapes the form.
 */

const LICENSES = ["MIT", "Apache-2.0", "BSD-3-Clause", "GPL-3.0", "CC-BY-4.0", "CC0-1.0", "Proprietary (surrendered)", "Unknown"];
const AGREEMENT_VERSION = "shelter-surrender/1";
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

function list(value, { lines = false } = {}) {
  return value
    .split(lines ? /\n/ : /[\n,]/)
    .map((s) => s.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

function checked(value) {
  return /-\s*\[x\]/i.test(value);
}

/** Returns { payload } or { error } — never throws. */
function buildPayload({ body, author }) {
  const s = parseForm(body);
  const kind = field(s, "kind").toLowerCase().includes("mcp") ? "mcp" : "agent";
  const missing = [];
  const need = (label, value) => {
    if (!value) missing.push(label);
    return value;
  };

  const license = field(s, "license");
  const sharePct = Number.parseInt(field(s, "creator share (%)") || "10", 10);
  const payload = {
    name: need("Name", field(s, "name")),
    tagline: need("Tagline", field(s, "tagline")),
    story: need("Story", field(s, "story")),
    creatorName: field(s, "creator name") || author || "",
    creatorContact: field(s, "creator contact") || (author ? `https://github.com/${author}` : ""),
    license: LICENSES.includes(license) ? license : "Unknown",
    attestation: checked(field(s, "agreement")),
    agreementVersion: AGREEMENT_VERSION,
    creatorSharePct: Number.isFinite(sharePct) ? Math.min(10, Math.max(0, sharePct)) : 10,
  };
  need("Creator name", payload.creatorName);
  need("Creator contact", payload.creatorContact);

  if (kind === "mcp") {
    payload.spec = {
      kind: "mcp",
      endpoint: need("MCP endpoint", field(s, "mcp endpoint")),
      expose: list(field(s, "tools to expose")),
    };
  } else {
    const spec = {
      kind: "agent",
      systemPrompt: need("System prompt", field(s, "system prompt")),
      skills: list(field(s, "skills")).slice(0, 12),
      memory: list(field(s, "memory"), { lines: true }).slice(0, 40),
      tools: [],
    };
    const greeting = field(s, "greeting");
    if (greeting) spec.greeting = greeting;
    payload.spec = spec;
  }

  if (missing.length) return { error: `Missing required field(s): ${missing.join(", ")}.` };
  if (!payload.attestation) return { error: "The agreement box was not ticked — the shelter only takes software you have the right to surrender." };
  return { payload };
}

function isSurrenderIssue(issue) {
  const title = String(issue?.title || "");
  const labels = (issue?.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  return /^\[surrender/i.test(title) || labels.includes("surrender");
}

function formatChecks(checks) {
  if (!Array.isArray(checks) || !checks.length) return "";
  const rows = checks.map((c) => `| ${c.ok ? "pass" : "**fail**"} | ${String(c.id ?? c.name ?? "").replace(/\|/g, "\\|")} | ${String(c.detail ?? "").replace(/\|/g, "\\|")} |`);
  return ["", "| | Check | Detail |", "|---|---|---|", ...rows].join("\n");
}

/** Entry point for actions/github-script. */
async function run({ github, context, core, fetchImpl = fetch, origin }) {
  const issue = context.payload.issue;
  if (!isSurrenderIssue(issue)) {
    core.info("Not a surrender issue — skipping.");
    return;
  }
  const base = (origin || "https://agent-shelter-neuraldeepnet.on.adaptive.ai").replace(/\/+$/, "");
  const repo = { owner: context.repo.owner, repo: context.repo.repo, issue_number: issue.number };
  const comment = (body) => github.rest.issues.createComment({ ...repo, body });
  const label = (name) => github.rest.issues.addLabels({ ...repo, labels: [name] }).catch(() => undefined);

  const built = buildPayload({ body: issue.body, author: issue.user?.login });
  if (built.error) {
    await comment(`Could not submit this to the shelter yet: ${built.error}\n\nEdit the issue to fix it, then remove and re-add the \`surrender\` label to retry.`);
    await label("needs-info");
    return;
  }

  let status = 0;
  let out = {};
  try {
    const res = await fetchImpl(`${base}/api/shelter/surrender`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "agent-shelter-github-intake" },
      body: JSON.stringify(built.payload),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    out = await res.json().catch(() => ({}));
  } catch (error) {
    core.setFailed(`Shelter unreachable: ${error instanceof Error ? error.message : String(error)}`);
    await comment("The shelter request could not be confirmed; it may have reached intake before the connection failed. Please don't retry or open another surrender issue yet. A maintainer should check the live shelter first to avoid creating a duplicate.");
    return;
  }

  if (status === 201 && out.accepted) {
    await comment(
      [
        `**${built.payload.name}** has checked in. Welcome to the shelter.`,
        "",
        `- Slug: \`${out.slug}\``,
        `- Status: \`${out.status}\` — behavioural screening runs next, then the owner's approval policy decides.`,
        `- Résumé page: ${out.resume}`,
        `- Track it over MCP: \`get_resident\` with \`{"slug":"${out.slug}"}\` at ${base}/api/mcp`,
        formatChecks(out.checks),
      ].join("\n"),
    );
    await label("landed");
    return;
  }

  if (status >= 500) {
    core.setFailed(`Shelter returned HTTP ${status}; intake may have been accepted before the failure.`);
    await comment(`The shelter returned HTTP ${status}, so this issue cannot confirm whether intake succeeded. Please don't retry or open another surrender issue yet. A maintainer should check the live shelter first to avoid creating a duplicate.`);
    return;
  }

  await comment(
    [
      `The shelter did not take this one in (HTTP ${status}).`,
      "",
      `> ${out.detail || out.title || "No detail returned."}`,
      formatChecks(out.checks),
      "",
      "Edit the issue to address the failing checks, then remove and re-add the `surrender` label to retry.",
    ].join("\n"),
  );
  await label("refused");
}

module.exports = { parseForm, buildPayload, isSurrenderIssue, run };
