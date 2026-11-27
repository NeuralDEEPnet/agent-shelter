import { db } from "@/api/db";
import { publicHttpsFetch } from "@/api/services/public-https";
import type { McpFetch } from "@/api/services/mcpClient";
import { packageSpecSchema, packageRegistryUrl, packageInstallLine } from "@/api/services/intake";
import { gitlabPathOf, repoUrlOf } from "@/api/services/registry";
import { abandonedServerFor, SUCCESSORS_CHECKED_AT, type Replacement } from "@/api/data/successors";

const GITLAB_GRAPHQL = "https://gitlab.com/api/graphql";
const GITLAB_ARCHIVED_QUERY = "query($path: ID!) { project(fullPath: $path) { archived } }";

/**
 * Rescue check: "is this MCP package still looked after — and if not, what
 * works instead?" A free, read-only look at what npm / PyPI (and GitHub or
 * GitLab, best effort) publish about a package, plus whether it already lives
 * at the shelter. Nothing is installed or run. The verdict is a statement about
 * public signals, never about code quality.
 *
 * Signals (measured on the live registries, 2026-11-20):
 * - npm release date: the `last-modified` header of the latest tarball (exact,
 *   tiny). The abbreviated packument's `modified` moves on deprecation and is
 *   over the 256 KB fetch cap for heavy releasers, so it is not used.
 * - npm `/latest` 404 with "version not found" means the package was
 *   unpublished (gone); a plain 404 means the name never existed.
 * - Deprecation notices usually name the successor ("Renamed to X",
 *   "has moved to X", "npx X", "pip install X"); that is the "use instead".
 * - PyPI: names are PEP 503-normalised; project-status (PEP 792) comes from
 *   the simple JSON API; the "Development Status :: 7 - Inactive" classifier
 *   and a yanked latest release count as abandoned. Projects whose JSON is
 *   over the fetch cap fall back to the releases RSS feed + per-version JSON.
 */

export type RescueVerdict = "sheltered" | "moved" | "abandoned" | "gone" | "stale" | "maintained" | "unknown" | "not-found";
/** `name` is a package in the same registry (checkable); `label` is a display name for any other kind of successor. */
export type Successor = { name: string | null; url: string | null; exists: boolean | null; note: string; label?: string };
export type RescueCheck = {
  registry: "npm" | "pypi";
  name: string;
  verdict: RescueVerdict;
  headline: string;
  signals: string[];
  latestVersion: string | null;
  description: string | null;
  license: string | null;
  lastReleaseAt: string | null;
  daysSinceRelease: number | null;
  deprecated: string | null;
  repository: string | null;
  repositoryArchived: boolean | null;
  successor: Successor | null;
  /** Verified "what works instead" from the curated table (src/api/data/successors.ts), best first. */
  replacements: Replacement[];
  /** Curated status of a known abandoned server, with its evidence. */
  curated: { id: string; status: "archived" | "stale"; summary: string; evidence: string } | null;
  registryUrl: string;
  install: string;
  resident: { slug: string; name: string; status: string } | null;
  checkedAt: string;
};
export type RescueOutcome = { ok: true; check: RescueCheck; cached: boolean } | { ok: false; status: 400 | 429 | 502; code: string; detail: string; retryAfter?: number };

const STALE_DAYS = 365;
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE = 1_000;
const MAX_OUTBOUND_PER_MINUTE = 30;
const UA = "agent-shelter-rescue-check/1.1 (+https://agent-shelter-neuraldeepnet.on.adaptive.ai)";

const cache = new Map<string, { at: number; check: RescueCheck; base: Omit<VerdictInput, "resident"> }>();
let outbound: number[] = [];

export function resetRescueCheck() {
  cache.clear();
  outbound = [];
}

const nameSchema = packageSpecSchema.shape.name;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** PEP 503: lowercase, runs of `-`, `_` and `.` become one `-`. */
export function normalisePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

type Read = { status: number; body: unknown; text: string | null; headers: Headers | null; tooLarge?: boolean };
async function read(fetchImpl: McpFetch, url: string, init: { accept?: string; method?: "GET" | "HEAD" | "POST"; json?: boolean; body?: unknown } = {}): Promise<Read> {
  try {
    const headers: Record<string, string> = { accept: init.accept ?? "application/json", "user-agent": UA };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(url, { method: init.method ?? "GET", headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (init.method === "HEAD") return { status: res.status, body: null, text: null, headers: res.headers };
    const text = await res.text();
    let body: unknown = null;
    if (init.json !== false && res.ok) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: res.status, body, text: text.slice(0, 2_000), headers: res.headers };
  } catch (error) {
    if (error instanceof Error && /exceeded \d+ bytes/.test(error.message)) return { status: 200, body: null, text: null, headers: null, tooLarge: true };
    throw error;
  }
}

/**
 * The successor a deprecation notice names, if any. Install commands win over
 * prose ("Omnicord is now discord-mcp: npx @orygn/discord-mcp init" → the npx
 * target). Returns null when the notice names nothing usable.
 */
export function successorFrom(notice: string | null, self: string): Successor | null {
  if (!notice) return null;
  const text = notice.replace(/\s+/g, " ").trim().slice(0, 500);
  const clean = (s: string | undefined) => (s ?? "").replace(/^[`'"(<]+|[`'".,;:!)>]+$/g, "").replace(/@(?:latest|\^?\d[\w.-]*)$/, "");
  const ok = (s: string) => PACKAGE_NAME.test(s) && s.length <= 214 && s.toLowerCase() !== self.toLowerCase() && !/^(that|this|the|it|a|an|use|install|instead|now|new|version|package|here)$/i.test(s);
  const commands = [
    /\bnpx\s+(?:-y\s+|--yes\s+)?([@\w./-]+)/i,
    /\bnpm\s+(?:i|install|add)\s+(?:-g\s+|--global\s+|-D\s+|--save-dev\s+)*([@\w./-]+)/i,
    /\b(?:pnpm|yarn)\s+(?:add|dlx)\s+(?:-g\s+)*([@\w./-]+)/i,
    /\buvx\s+([\w.-]+)/i,
    /\bpip3?\s+install\s+(?:-U\s+|--upgrade\s+)*([\w.-]+)/i,
  ];
  const prose = [
    /\b(?:renamed|moved|migrated|transferred|republished)\s+(?:to|as)\s+(?:the\s+)?(?:package\s+)?([`'"]?@?[\w.-]+(?:\/[\w.-]+)?[`'"]?)/i,
    /\b(?:replaced|superseded)\s+by\s+(?:the\s+)?(?:package\s+)?([`'"]?@?[\w.-]+(?:\/[\w.-]+)?[`'"]?)/i,
    /\bin\s+favou?r\s+of\s+([`'"]?@?[\w.-]+(?:\/[\w.-]+)?[`'"]?)/i,
    /\b(?:use|install|try)\s+([`'"]?@?[\w.-]+(?:\/[\w.-]+)?[`'"]?)\s+instead\b/i,
    /\bis\s+now\s+(?:published\s+as\s+|called\s+)?([`'"]?@?[\w.-]+(?:\/[\w.-]+)?[`'"]?)/i,
  ];
  for (const re of [...commands, ...prose]) {
    const m = re.exec(text);
    const candidate = clean(m?.[1]);
    if (candidate && ok(candidate)) return { name: candidate, url: null, exists: null, note: text };
  }
  // A bare link is a successor only when the notice says to go there ("migrate to <url>", "moved to <url>").
  // "See <archive>" or "Contact support at <url>" is not one.
  const url = /\b(?:migrate|moved|move|switch|use|replaced\s+by|now\s+at|lives\s+at)\b[^.]{0,40}?(https:\/\/[^\s"'<>)]+)/i.exec(text)?.[1]?.replace(/[.,;:!)]+$/, "") ?? null;
  if (!url || /npmjs\.com\/support|servers-archived/i.test(url)) return null;
  return { name: null, url, exists: null, note: text };
}

/** A parked or hosted resident that IS this package (by registry + name). */
async function residentFor(registry: string, name: string): Promise<RescueCheck["resident"]> {
  const rows = await db.resident.findMany({ where: { kind: "package", status: { not: "rejected" } }, select: { slug: true, name: true, status: true, spec: true } });
  const same = (a: string, b: string) => (registry === "pypi" ? normalisePypiName(a) === normalisePypiName(b) : a.toLowerCase() === b.toLowerCase());
  for (const r of rows) {
    try {
      const spec = JSON.parse(r.spec) as { registry?: string; name?: string };
      if (spec.registry === registry && spec.name && same(spec.name, name)) return { slug: r.slug, name: r.name, status: r.status };
    } catch {
      /* unreadable spec: not a match */
    }
  }
  return null;
}

export type VerdictInput = { found: boolean; gone?: boolean; resident: boolean; deprecated: string | null; successor?: Successor | null; archived: boolean | null; inactive?: boolean; daysSinceRelease: number | null; curated?: { replaced: boolean } | null };
export function verdictOf(input: VerdictInput): RescueVerdict {
  if (input.resident) return "sheltered";
  if (!input.found) return "not-found";
  if (input.gone) return "gone";
  if (input.curated) return input.curated.replaced ? "moved" : "abandoned";
  if (input.deprecated && input.successor && ((input.successor.name && input.successor.exists !== false) || (!input.successor.name && input.successor.url))) return "moved";
  if (input.deprecated || input.archived || input.inactive) return "abandoned";
  if (input.daysSinceRelease === null) return "unknown";
  return input.daysSinceRelease >= STALE_DAYS ? "stale" : "maintained";
}

function headlineFor(verdict: RescueVerdict, successor: Successor | null): string {
  switch (verdict) {
    case "sheltered":
      return "Already safe: this package lives at the shelter.";
    case "moved":
      return successor?.label ? `Replaced: ${successor.label} does this job now. Use that instead.` : successor?.name ? `Moved: its maintainer points to ${successor.name}. Use that instead.` : "Moved: its maintainer points elsewhere. Read the notice below.";
    case "abandoned":
      return "Abandoned by its public signals. It can be parked at the shelter for free.";
    case "gone":
      return "Gone: the registry knows the name, but every version was unpublished.";
    case "stale":
      return "No release in over a year. Not declared abandoned, but nobody is visibly looking after it.";
    case "maintained":
      return "Looked after: a release within the last year and no deprecation notice.";
    case "unknown":
      return "The registry knows it, but publishes no release date we could read.";
    case "not-found":
      return "The registry has no package by this name.";
  }
}

export async function checkPackage(input: { registry: unknown; name: unknown }, options: { fetch?: McpFetch; now?: number } = {}): Promise<RescueOutcome> {
  const registry = input.registry === "pypi" ? "pypi" : input.registry === "npm" || input.registry === undefined || input.registry === null || input.registry === "" ? "npm" : null;
  if (!registry) return { ok: false, status: 400, code: "invalid", detail: "`registry` is npm or pypi." };
  const parsed = nameSchema.safeParse(typeof input.name === "string" ? input.name : "");
  if (!parsed.success) return { ok: false, status: 400, code: "invalid", detail: "`name` must be a plain npm or PyPI package name (npm scopes allowed)." };
  const name = registry === "pypi" ? normalisePypiName(parsed.data) : parsed.data;
  if (registry === "pypi" && name.startsWith("@")) return { ok: false, status: 400, code: "invalid", detail: "PyPI names have no scope." };
  const now = options.now ?? Date.now();
  const key = `${registry}:${name.toLowerCase()}`;
  const resident = await residentFor(registry, name);
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) {
    const verdict = verdictOf({ ...hit.base, resident: Boolean(resident) });
    return { ok: true, cached: true, check: { ...hit.check, resident, verdict, headline: headlineFor(verdict, hit.check.successor) } };
  }
  outbound = outbound.filter((t) => now - t < 60_000);
  if (outbound.length >= MAX_OUTBOUND_PER_MINUTE) return { ok: false, status: 429, code: "busy", detail: "The rescue check is reading too many registries right now. Try again in a minute.", retryAfter: 60 };
  outbound.push(now);

  const fetchImpl = options.fetch ?? publicHttpsFetch;
  let found = true;
  let gone = false;
  let inactive = false;
  let latestVersion: string | null = null;
  let description: string | null = null;
  let license: string | null = null;
  let deprecated: string | null = null;
  let repository: string | null = null;
  let lastReleaseAt: string | null = null;
  const signals: string[] = [];
  try {
    if (registry === "npm") {
      const latest = await read(fetchImpl, `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`);
      if (latest.status === 404) {
        if (/version not found/i.test(latest.text ?? "")) gone = true;
        else found = false;
      } else if (!latest.body || latest.status !== 200) throw new Error(latest.tooLarge ? "registry.npmjs.org answered with an oversized document" : `HTTP ${latest.status} from registry.npmjs.org`);
      else {
        const doc = latest.body as Record<string, unknown>;
        latestVersion = str(doc.version, 64);
        description = str(doc.description, 500);
        license = typeof doc.license === "string" ? str(doc.license, 80) : str((doc.license as { type?: unknown } | undefined)?.type, 80);
        deprecated = str(doc.deprecated, 500);
        repository = repoUrlOf(doc.repository) ?? null;
        const tarball = str((doc.dist as { tarball?: unknown } | undefined)?.tarball, 2_000);
        if (tarball && /^https:\/\/registry\.npmjs\.org\//.test(tarball)) {
          try {
            const head = await read(fetchImpl, tarball, { method: "HEAD", accept: "*/*" });
            lastReleaseAt = head.status === 200 ? str(head.headers?.get("last-modified"), 64) : null;
          } catch {
            /* the date stays unknown */
          }
        }
      }
    } else {
      const project = await read(fetchImpl, `https://pypi.org/pypi/${name}/json`);
      if (project.status === 404) found = false;
      else {
        let info: Record<string, unknown> = {};
        let uploadedAt: string | null = null;
        let yanked = false;
        if (project.tooLarge) {
          // Large projects: the releases feed names the latest version and its date; per-version JSON is small.
          const rss = await read(fetchImpl, `https://pypi.org/rss/project/${name}/releases.xml`, { accept: "application/rss+xml", json: false });
          const item = /<item>[\s\S]*?<title>([^<]{1,64})<\/title>[\s\S]*?<pubDate>([^<]{1,64})<\/pubDate>/.exec(rss.text ?? "");
          if (!item) throw new Error("pypi.org answered with an oversized document and no release feed");
          uploadedAt = item[2]!.trim();
          const version = await read(fetchImpl, `https://pypi.org/pypi/${name}/${encodeURIComponent(item[1]!.trim())}/json`);
          info = ((version.body as { info?: Record<string, unknown> } | null)?.info ?? {}) as Record<string, unknown>;
          yanked = info.yanked === true;
        } else if (!project.body || project.status !== 200) throw new Error(`HTTP ${project.status} from pypi.org`);
        else {
          const doc = project.body as { info?: Record<string, unknown>; urls?: { upload_time_iso_8601?: unknown; yanked?: unknown }[] };
          info = doc.info ?? {};
          uploadedAt = str(doc.urls?.[0]?.upload_time_iso_8601, 40);
          yanked = info.yanked === true || (doc.urls?.length ? doc.urls.every((u) => u.yanked === true) : false);
        }
        latestVersion = str(info.version, 64);
        description = str(info.summary, 500);
        license = str(String(info.license_expression ?? info.license ?? "").split("\n")[0], 40);
        lastReleaseAt = uploadedAt;
        const urls = (info.project_urls ?? {}) as Record<string, unknown>;
        repository = repoUrlOf(Object.values(urls).find((v) => typeof v === "string" && /(?:github|gitlab)\.com\//.test(v))) ?? null;
        const classifiers = Array.isArray(info.classifiers) ? (info.classifiers as unknown[]).filter((c): c is string => typeof c === "string") : [];
        if (classifiers.some((c) => /Development Status :: 7 - Inactive/i.test(c))) {
          inactive = true;
          signals.push("its classifiers say Development Status :: 7 - Inactive");
        }
        if (yanked) deprecated = "the latest release is yanked";
        // PEP 792 project status lives in the simple JSON API; best effort (large projects exceed the cap).
        try {
          const simple = await read(fetchImpl, `https://pypi.org/simple/${name}/`, { accept: "application/vnd.pypi.simple.v1+json" });
          const status = (simple.body as { "project-status"?: { status?: unknown; reason?: unknown } } | null)?.["project-status"];
          const s = str(status?.status, 32);
          if (s && s !== "active") {
            deprecated = deprecated ?? `PyPI project status: ${s}${str(status?.reason, 400) ? ` — ${str(status?.reason, 400)}` : ""}`;
            if (s === "archived" || s === "quarantined") inactive = true;
          }
        } catch {
          /* status stays unknown */
        }
      }
    }
  } catch (error) {
    return { ok: false, status: 502, code: "registry-unreachable", detail: `Could not read the registry: ${error instanceof Error ? error.message : String(error)}` };
  }

  let repositoryArchived: boolean | null = null;
  const gh = repository ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository) : null;
  const gitlab = repository ? gitlabPathOf(repository) : null;
  const repositoryHost = gh ? "GitHub" : gitlab ? "GitLab" : null;
  if (gh && found && !gone) {
    try {
      const repo = await read(fetchImpl, `https://api.github.com/repos/${gh[1]}/${gh[2]}`, { accept: "application/vnd.github+json" });
      const body = repo.body as { archived?: unknown } | null;
      if (body && typeof body.archived === "boolean") repositoryArchived = body.archived;
    } catch {
      /* best effort: GitHub rate limits anonymous reads */
    }
  } else if (gitlab && found && !gone) {
    // GitLab's REST API leaves `archived` out of anonymous reads; its GraphQL API answers it for public projects.
    try {
      const repo = await read(fetchImpl, GITLAB_GRAPHQL, { method: "POST", body: { query: GITLAB_ARCHIVED_QUERY, variables: { path: gitlab } } });
      const project = (repo.body as { data?: { project?: { archived?: unknown } | null } } | null)?.data?.project;
      if (project && typeof project.archived === "boolean") repositoryArchived = project.archived;
    } catch {
      /* best effort, like GitHub */
    }
  }

  let successor = successorFrom(deprecated, name);
  const known = found && !gone ? abandonedServerFor(registry, name) : null;
  const firstReal = known?.replacements.find((r) => r.kind !== "alternative") ?? null;
  if (known && firstReal && !successor?.name) {
    // A verified replacement from the curated table beats a link-only notice.
    const [pkgRegistry, ...rest] = (firstReal.package ?? "").split(":");
    const pkgName = rest.join(":");
    successor = { name: pkgRegistry === registry && pkgName ? pkgName : null, url: firstReal.remoteUrl ?? firstReal.evidence[0] ?? null, exists: true, note: firstReal.how, label: firstReal.name };
  }
  if (successor?.name && registry === "npm") {
    try {
      const next = await read(fetchImpl, `https://registry.npmjs.org/${successor.name.replace("/", "%2F")}/latest`);
      successor = { ...successor, exists: next.status === 200 };
    } catch {
      /* existence stays unknown */
    }
  }

  const releasedMs = lastReleaseAt ? Date.parse(lastReleaseAt) : NaN;
  const daysSinceRelease = Number.isFinite(releasedMs) ? Math.max(0, Math.floor((now - releasedMs) / 86_400_000)) : null;
  lastReleaseAt = daysSinceRelease === null ? null : new Date(releasedMs).toISOString();
  const base = { found, gone, deprecated, successor, archived: repositoryArchived, inactive, daysSinceRelease, curated: known ? { replaced: Boolean(firstReal) } : null };
  const verdict = verdictOf({ ...base, resident: Boolean(resident) });
  if (!found) signals.unshift(`${registry} has no package named ${name}`);
  if (gone) signals.unshift(`${registry} knows ${name}, but no version is published any more (unpublished)`);
  if (deprecated) signals.unshift(registry === "npm" ? `deprecated on npm: ${deprecated}` : deprecated);
  if (successor?.name && !successor.label) signals.push(`the notice points to ${successor.name}${successor.exists === true ? ", which is published" : successor.exists === false ? ", which is NOT published — check the notice" : ""}`);
  if (known) signals.push(`${known.summary} (checked ${SUCCESSORS_CHECKED_AT}: ${known.statusEvidence})`);
  if (known?.replacements.length) signals.push(`${known.replacements.length} verified replacement${known.replacements.length === 1 ? "" : "s"} listed below`);
  if (repositoryArchived) signals.push(`its ${repositoryHost ?? "source"} repository is archived (read-only)`);
  if (daysSinceRelease !== null) signals.push(`latest release ${daysSinceRelease} day${daysSinceRelease === 1 ? "" : "s"} ago${latestVersion ? ` (${latestVersion})` : ""}`);
  if (found && !gone && repositoryArchived === false) signals.push(`its ${repositoryHost ?? "source"} repository is not archived`);
  if (found && !gone && !repository) signals.push("no source repository is linked from the registry");
  if (found && !gone && repository && repositoryArchived === null) signals.push("could not read whether its repository is archived");

  const check: RescueCheck = {
    registry,
    name,
    verdict,
    headline: headlineFor(verdict, successor),
    signals,
    latestVersion,
    description,
    license,
    lastReleaseAt,
    daysSinceRelease,
    deprecated,
    repository,
    repositoryArchived,
    successor,
    replacements: known?.replacements ?? [],
    curated: known ? { id: known.id, status: known.status, summary: known.summary, evidence: known.statusEvidence } : null,
    registryUrl: packageRegistryUrl({ registry, name }),
    install: packageInstallLine({ registry, name, command: undefined }),
    resident,
    checkedAt: new Date(now).toISOString(),
  };
  cache.set(key, { at: now, check, base });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return { ok: true, check, cached: false };
}

/** Links a caller needs after a check: the résumé, the successor's check, or the pre-filled intake; the human page; the badge. */
export function rescueLinks(check: RescueCheck, origin: string) {
  const q = `registry=${check.registry}&name=${encodeURIComponent(check.name)}`;
  const parkable = !check.resident && ["abandoned", "stale"].includes(check.verdict);
  return {
    page: `${origin}/check?${q}`,
    resume: check.resident ? `${origin}/r/${check.resident.slug}` : null,
    badge: check.resident ? `${origin}/api/shelter/badge/${check.resident.slug}.svg` : null,
    successor: check.successor?.name ? `${origin}/check?registry=${check.registry}&name=${encodeURIComponent(check.successor.name)}` : (check.successor?.url ?? null),
    instead: check.curated ? `${origin}/instead/${check.curated.id}` : null,
    surrender: parkable ? `${origin}/surrender?kind=package&${q}` : null,
  };
}
