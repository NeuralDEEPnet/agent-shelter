import { publicHttpsFetch } from "@/api/services/public-https";
import type { McpFetch } from "@/api/services/mcpClient";
import type { PackageSpec } from "@/api/services/intake";

/**
 * Public package-registry reads for parked `package` residents. The shelter
 * never installs or runs the package: it reads what npm / PyPI publish about
 * it (description, latest version, licence, deprecation notice, repository)
 * and the README from GitHub when the repository is there, so the résumé and
 * the archive-desk agent have real material. Same pinned public-https fetch
 * as everything else that touches the outside.
 */

export type RegistryFetch = McpFetch;
export type RegistryMeta = NonNullable<PackageSpec["registryMeta"]>;
export type DeclaredTool = { name: string; description: string };

const README_MAX = 20_000;
const UA = "agent-shelter-registry-reader/1.0 (+https://agent-shelter-neuraldeepnet.on.adaptive.ai)";

async function getJson(fetchImpl: McpFetch, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

async function getText(fetchImpl: McpFetch, url: string): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "text/plain, text/markdown;q=0.9, */*;q=0.1", "user-agent": UA }, signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!res.ok) return null;
    return (await res.text()).slice(0, README_MAX);
  } catch {
    return null;
  }
}

/** github.com/owner/repo (any form) → raw README URL candidates. */
export function githubReadmeUrls(repo: string | undefined): string[] {
  if (!repo) return [];
  const m = /github\.com[/:]([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/i.exec(repo);
  if (!m) return [];
  const [, owner, name] = m;
  return ["README.md", "readme.md", "README.MD", "Readme.md"].map((f) => `https://raw.githubusercontent.com/${owner}/${name}/HEAD/${f}`);
}

/** Tools mentioned in a README: `tool_name` — description, or ### tool_name headings. Best effort, capped. */
export function toolsFromReadme(readme: string): DeclaredTool[] {
  const found = new Map<string, string>();
  const lineRe = /^\s*(?:[-*]|\d+\.)\s+`([a-zA-Z][a-zA-Z0-9_.-]{1,63})`\s*[:—–-]\s*(.{3,300})$/gm;
  for (const m of readme.matchAll(lineRe)) if (!found.has(m[1]!)) found.set(m[1]!, m[2]!.trim());
  const headRe = /^#{2,4}\s+`?([a-z][a-z0-9_]{2,63})`?\s*$/gm;
  for (const m of readme.matchAll(headRe)) if (!found.has(m[1]!) && /_/.test(m[1]!)) found.set(m[1]!, "");
  return [...found.entries()].slice(0, 32).map(([name, description]) => ({ name, description: description.slice(0, 500) }));
}

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function repoUrlOf(v: unknown): string | undefined {
  const raw = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : undefined;
  if (!raw) return undefined;
  const m = /github\.com[/:]([^/\s#]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/i.exec(raw);
  return m ? `https://github.com/${m[1]}/${m[2]}` : clean(raw.replace(/^git\+/, ""), 2_000);
}

export type PackageMetaOutcome = { ok: true; meta: RegistryMeta; tools: DeclaredTool[] } | { ok: false; detail: string };

export async function fetchPackageMeta(spec: Pick<PackageSpec, "registry" | "name" | "repo">, options: { fetch?: McpFetch } = {}): Promise<PackageMetaOutcome> {
  const fetchImpl = options.fetch ?? publicHttpsFetch;
  try {
    let meta: RegistryMeta;
    if (spec.registry === "npm") {
      // The abbreviated `latest` document stays small; full documents of popular packages exceed the fetch cap.
      const doc = (await getJson(fetchImpl, `https://registry.npmjs.org/${spec.name.replace("/", "%2F")}/latest`)) as Record<string, unknown>;
      meta = {
        description: clean(doc.description, 1_000),
        latestVersion: clean(doc.version, 64),
        license: typeof doc.license === "string" ? clean(doc.license, 80) : clean((doc.license as { type?: unknown } | undefined)?.type, 80),
        homepage: clean(doc.homepage, 2_000),
        repository: repoUrlOf(doc.repository),
        deprecated: clean(doc.deprecated, 500),
      };
    } else {
      const doc = (await getJson(fetchImpl, `https://pypi.org/pypi/${spec.name}/json`)) as { info?: Record<string, unknown> };
      const info = doc.info ?? {};
      const urls = (info.project_urls ?? {}) as Record<string, unknown>;
      const repoCandidate = Object.entries(urls).find(([k, v]) => /source|repository|github|code|homepage/i.test(k) && typeof v === "string" && /github\.com/.test(v))?.[1];
      meta = {
        description: clean(info.summary, 1_000),
        latestVersion: clean(info.version, 64),
        license: clean(info.license, 80),
        homepage: clean(info.home_page, 2_000) ?? clean(urls.Homepage, 2_000),
        repository: repoUrlOf(repoCandidate),
        deprecated: info.yanked === true ? "latest release is yanked" : undefined,
        readme: clean(info.description, README_MAX),
      };
    }
    const repo = spec.repo ?? meta.repository;
    if (!meta.readme) {
      for (const url of githubReadmeUrls(repo)) {
        const text = await getText(fetchImpl, url);
        if (text) {
          meta.readme = text;
          break;
        }
      }
    }
    meta.fetchedAt = new Date().toISOString();
    return { ok: true, meta, tools: meta.readme ? toolsFromReadme(meta.readme) : [] };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
