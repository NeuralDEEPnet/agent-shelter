import { db } from "@/api/db";
import { publicHttpsFetch } from "@/api/services/public-https";
import type { McpFetch } from "@/api/services/mcpClient";
import { packageSpecSchema, packageRegistryUrl, packageInstallLine } from "@/api/services/intake";
import { repoUrlOf } from "@/api/services/registry";

/**
 * Rescue check: "is this MCP package still looked after?" — a free, read-only
 * look at what npm / PyPI (and GitHub, best effort) publish about a package,
 * plus whether it already lives at the shelter. Nothing is installed or run.
 * The verdict is a statement about public signals, never about code quality.
 */

export type RescueVerdict = "sheltered" | "abandoned" | "stale" | "maintained" | "unknown" | "not-found";
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
const UA = "agent-shelter-rescue-check/1.0 (+https://agent-shelter-neuraldeepnet.on.adaptive.ai)";

const cache = new Map<string, { at: number; check: RescueCheck }>();
let outbound: number[] = [];

export function resetRescueCheck() {
  cache.clear();
  outbound = [];
}

const nameSchema = packageSpecSchema.shape.name;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function getJson(fetchImpl: McpFetch, url: string, accept = "application/json"): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, { method: "GET", headers: { accept, "user-agent": UA }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json() };
}

/** A parked or hosted resident that IS this package (by registry + name). */
async function residentFor(registry: string, name: string): Promise<RescueCheck["resident"]> {
  const rows = await db.resident.findMany({ where: { kind: "package", status: { not: "rejected" } }, select: { slug: true, name: true, status: true, spec: true } });
  for (const r of rows) {
    try {
      const spec = JSON.parse(r.spec) as { registry?: string; name?: string };
      if (spec.registry === registry && spec.name?.toLowerCase() === name.toLowerCase()) return { slug: r.slug, name: r.name, status: r.status };
    } catch {
      /* unreadable spec: not a match */
    }
  }
  return null;
}

export function verdictOf(input: { found: boolean; resident: boolean; deprecated: string | null; archived: boolean | null; daysSinceRelease: number | null }): RescueVerdict {
  if (input.resident) return "sheltered";
  if (!input.found) return "not-found";
  if (input.deprecated || input.archived) return "abandoned";
  if (input.daysSinceRelease === null) return "unknown";
  return input.daysSinceRelease >= STALE_DAYS ? "stale" : "maintained";
}

const HEADLINES: Record<RescueVerdict, string> = {
  sheltered: "Already safe: this package lives at the shelter.",
  abandoned: "Abandoned by its public signals. It can be parked at the shelter for free.",
  stale: "No release in over a year. Not declared abandoned, but nobody is visibly looking after it.",
  maintained: "Looked after: a release within the last year and no deprecation notice.",
  unknown: "The registry knows it, but publishes no release date we could read.",
  "not-found": "The registry does not know this package.",
};

export async function checkPackage(input: { registry: unknown; name: unknown }, options: { fetch?: McpFetch; now?: number } = {}): Promise<RescueOutcome> {
  const registry = input.registry === "pypi" ? "pypi" : input.registry === "npm" || input.registry === undefined || input.registry === null || input.registry === "" ? "npm" : null;
  if (!registry) return { ok: false, status: 400, code: "invalid", detail: "`registry` is npm or pypi." };
  const parsed = nameSchema.safeParse(typeof input.name === "string" ? input.name : "");
  if (!parsed.success) return { ok: false, status: 400, code: "invalid", detail: "`name` must be a plain npm or PyPI package name (npm scopes allowed)." };
  const name = parsed.data;
  const now = options.now ?? Date.now();
  const key = `${registry}:${name.toLowerCase()}`;
  const resident = await residentFor(registry, name);
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) {
    const verdict = verdictOf({ found: hit.check.verdict !== "not-found", resident: Boolean(resident), deprecated: hit.check.deprecated, archived: hit.check.repositoryArchived, daysSinceRelease: hit.check.daysSinceRelease });
    return { ok: true, cached: true, check: { ...hit.check, resident, verdict, headline: HEADLINES[verdict] } };
  }
  outbound = outbound.filter((t) => now - t < 60_000);
  if (outbound.length >= MAX_OUTBOUND_PER_MINUTE) return { ok: false, status: 429, code: "busy", detail: "The rescue check is reading too many registries right now. Try again in a minute.", retryAfter: 60 };
  outbound.push(now);

  const fetchImpl = options.fetch ?? publicHttpsFetch;
  let found = true;
  let latestVersion: string | null = null;
  let description: string | null = null;
  let license: string | null = null;
  let deprecated: string | null = null;
  let repository: string | null = null;
  let lastReleaseAt: string | null = null;
  try {
    if (registry === "npm") {
      const latest = await getJson(fetchImpl, `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`);
      if (latest.status === 404) found = false;
      else if (!latest.body) throw new Error(`HTTP ${latest.status} from registry.npmjs.org`);
      else {
        const doc = latest.body as Record<string, unknown>;
        latestVersion = str(doc.version, 64);
        description = str(doc.description, 500);
        license = typeof doc.license === "string" ? str(doc.license, 80) : str((doc.license as { type?: unknown } | undefined)?.type, 80);
        deprecated = str(doc.deprecated, 500);
        repository = repoUrlOf(doc.repository) ?? null;
        // The abbreviated packument carries `modified`; very large ones exceed the fetch cap and simply leave the date unknown.
        try {
          const abbreviated = await getJson(fetchImpl, `https://registry.npmjs.org/${name.replace("/", "%2F")}`, "application/vnd.npm.install-v1+json");
          lastReleaseAt = str((abbreviated.body as { modified?: unknown } | null)?.modified, 40);
        } catch {
          /* date stays unknown */
        }
      }
    } else {
      const res = await getJson(fetchImpl, `https://pypi.org/pypi/${name}/json`);
      if (res.status === 404) found = false;
      else if (!res.body) throw new Error(`HTTP ${res.status} from pypi.org`);
      else {
        const doc = res.body as { info?: Record<string, unknown>; urls?: { upload_time_iso_8601?: unknown }[] };
        const info = doc.info ?? {};
        latestVersion = str(info.version, 64);
        description = str(info.summary, 500);
        license = str(String(info.license ?? "").split("\n")[0], 40);
        deprecated = info.yanked === true ? "latest release is yanked" : null;
        const urls = (info.project_urls ?? {}) as Record<string, unknown>;
        repository = repoUrlOf(Object.values(urls).find((v) => typeof v === "string" && /github\.com/.test(v))) ?? null;
        lastReleaseAt = str(doc.urls?.[0]?.upload_time_iso_8601, 40);
      }
    }
  } catch (error) {
    return { ok: false, status: 502, code: "registry-unreachable", detail: `Could not read the registry: ${error instanceof Error ? error.message : String(error)}` };
  }

  let repositoryArchived: boolean | null = null;
  const gh = repository ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository) : null;
  if (gh) {
    try {
      const repo = await getJson(fetchImpl, `https://api.github.com/repos/${gh[1]}/${gh[2]}`, "application/vnd.github+json");
      const body = repo.body as { archived?: unknown } | null;
      if (body && typeof body.archived === "boolean") repositoryArchived = body.archived;
    } catch {
      /* best effort: GitHub rate limits anonymous reads */
    }
  }

  const releasedMs = lastReleaseAt ? Date.parse(lastReleaseAt) : NaN;
  const daysSinceRelease = Number.isFinite(releasedMs) ? Math.max(0, Math.floor((now - releasedMs) / 86_400_000)) : null;
  if (daysSinceRelease === null) lastReleaseAt = null;
  const verdict = verdictOf({ found, resident: Boolean(resident), deprecated, archived: repositoryArchived, daysSinceRelease });
  const signals: string[] = [];
  if (!found) signals.push(`${registry} has no package named ${name}`);
  if (deprecated) signals.push(`deprecated on ${registry}: ${deprecated}`);
  if (repositoryArchived) signals.push("its GitHub repository is archived (read-only)");
  if (daysSinceRelease !== null) signals.push(`${registry === "npm" ? "last registry change" : "last release"} ${daysSinceRelease} day${daysSinceRelease === 1 ? "" : "s"} ago${latestVersion ? ` (latest ${latestVersion})` : ""}`);
  if (found && repository && repositoryArchived === null) signals.push("could not read whether its repository is archived");
  if (found && repositoryArchived === false) signals.push("its GitHub repository is not archived");
  if (found && !repository) signals.push("no source repository is linked from the registry");

  const check: RescueCheck = {
    registry,
    name,
    verdict,
    headline: HEADLINES[verdict],
    signals,
    latestVersion,
    description,
    license,
    lastReleaseAt,
    daysSinceRelease,
    deprecated,
    repository,
    repositoryArchived,
    registryUrl: packageRegistryUrl({ registry, name }),
    install: packageInstallLine({ registry, name, command: undefined }),
    resident,
    checkedAt: new Date(now).toISOString(),
  };
  cache.set(key, { at: now, check });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return { ok: true, check, cached: false };
}

/** Links a caller needs after a check: the résumé or the pre-filled intake, the human page and the badge. */
export function rescueLinks(check: RescueCheck, origin: string) {
  const q = `registry=${check.registry}&name=${encodeURIComponent(check.name)}`;
  return {
    page: `${origin}/check?${q}`,
    resume: check.resident ? `${origin}/r/${check.resident.slug}` : null,
    badge: check.resident ? `${origin}/api/shelter/badge/${check.resident.slug}.svg` : null,
    surrender: check.resident || check.verdict === "not-found" ? null : `${origin}/surrender?kind=package&${q}`,
  };
}
