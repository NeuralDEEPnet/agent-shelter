/**
 * Graveyard hunt — DRY RUN ONLY.
 *
 * Finds MCP-server repositories on GitHub that look abandoned (archived, or no
 * push in > 6 months) and prints candidates as JSON lines. It sends NOTHING:
 * no issues, no PRs, no emails. Outreach is a later, owner-approved phase.
 *
 *   npx tsx scripts/find-abandoned-mcp.ts [--months 6] [--max 40] [--json] [--intake]
 *
 * --intake prints, for each candidate, the JSON body of a `package`-kind
 * surrender (POST /api/shelter/surrender) with the original author as creator —
 * the "foster" batch: the shelter parks the package with its README and the
 * author can claim or reclaim it. Review every line before sending any.
 *
 * Uses the public GitHub search API (10 req/min unauthenticated; set
 * GITHUB_TOKEN for 30/min). Never installs or executes anything it finds.
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[++i]!);
}
const months = Number(args.get("months") ?? 6);
const max = Number(args.get("max") ?? 40);
const asJson = args.has("json");
const asIntake = args.has("intake");
const ORIGIN = "https://agent-shelter-neuraldeepnet.on.adaptive.ai";

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);
const cutoffIso = cutoff.toISOString().slice(0, 10);

type Repo = {
  full_name: string;
  html_url: string;
  description: string | null;
  archived: boolean;
  pushed_at: string;
  stargazers_count: number;
  license: { spdx_id?: string } | null;
  topics?: string[];
  owner: { login: string; type: string };
};

const QUERIES = [
  `"mcp server" archived:true in:name,description`,
  `topic:mcp-server archived:true`,
  `"mcp server" pushed:<${cutoffIso} stars:>=5 in:name,description`,
  `topic:mcp-server pushed:<${cutoffIso} stars:>=5`,
  `"model context protocol" deprecated in:description`,
];

async function search(q: string): Promise<Repo[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "agent-shelter-graveyard-dryrun/1.0" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 403 || res.status === 429) {
    console.error(`rate limited on "${q}" — set GITHUB_TOKEN or wait a minute`);
    return [];
  }
  if (!res.ok) {
    console.error(`GitHub ${res.status} for "${q}"`);
    return [];
  }
  const body = (await res.json()) as { items?: Repo[] };
  return body.items ?? [];
}

const seen = new Map<string, Repo & { why: string[] }>();
for (const q of QUERIES) {
  const items = await search(q);
  for (const r of items) {
    const why: string[] = [];
    if (r.archived) why.push("archived");
    if (new Date(r.pushed_at) < cutoff) why.push(`no push since ${r.pushed_at.slice(0, 10)}`);
    if (/deprecated|unmaintained|no longer maintained|sunset/i.test(r.description ?? "")) why.push("says deprecated");
    if (!why.length) continue;
    const prev = seen.get(r.full_name);
    if (prev) prev.why = [...new Set([...prev.why, ...why])];
    else seen.set(r.full_name, { ...r, why });
  }
  // Be a polite unauthenticated client.
  await new Promise((r) => setTimeout(r, process.env.GITHUB_TOKEN ? 500 : 7_000));
}

const candidates = [...seen.values()]
  .sort((a, b) => b.stargazers_count - a.stargazers_count)
  .slice(0, max)
  .map((r) => ({
    repo: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    license: r.license?.spdx_id ?? "unknown",
    lastPush: r.pushed_at.slice(0, 10),
    why: r.why,
    description: (r.description ?? "").slice(0, 140),
    surrenderHint: `${ORIGIN}/surrender`,
    owner: r.owner.login,
  }));

/** A package-kind intake the shelter accepts today (no endpoint needed). npm name is guessed from the repo name; check it. */
function intakeFor(c: (typeof candidates)[number]) {
  const repoName = c.repo.split("/")[1] ?? c.repo;
  return {
    name: repoName.slice(0, 60),
    tagline: (c.description || `${repoName} — an MCP server that is no longer maintained.`).slice(0, 140),
    story: `Published at ${c.url} (${c.stars} stars, last push ${c.lastPush}; ${c.why.join(", ")}). Parked at the shelter so its record, README and tool list stay reachable and someone can pick it up. The original author can claim it any time.`.slice(0, 2000),
    creatorName: c.owner,
    creatorContact: `https://github.com/${c.owner}`,
    license: ["MIT", "Apache-2.0", "BSD-3-Clause", "GPL-3.0", "CC-BY-4.0", "CC0-1.0"].includes(c.license) ? c.license : "Unknown",
    attestation: true,
    agreementVersion: "shelter-surrender/1",
    creatorSharePct: 10,
    spec: { kind: "package", registry: "npm", name: repoName.toLowerCase(), repo: c.url },
  };
}

if (asIntake) {
  for (const c of candidates) console.log(JSON.stringify(intakeFor(c)));
} else if (asJson) {
  for (const c of candidates) console.log(JSON.stringify(c));
} else {
  console.log(`DRY RUN — ${candidates.length} candidate(s), nothing sent.\n`);
  for (const c of candidates) console.log(`${String(c.stars).padStart(5)} ★  ${c.repo}  [${c.license}]  ${c.why.join(", ")}\n        ${c.description}\n        ${c.url}`);
}
