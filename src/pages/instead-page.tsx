import { useState } from "react";
import { ArrowRight, Check, Copy, ExternalLink, Workflow } from "lucide-react";
import { AgenticStudiosBand } from "@/components/shelter/agentic-studios-bar";
import { Shell } from "@/components/shelter/shell";
import { ABANDONED_SERVERS, abandonedServerById, KIND_LABEL, SUCCESSORS_CHECKED_AT, type Replacement } from "@/api/data/successors";
import { buildRescueMarkdownSnippet, buildWorkbenchSharePath } from "@/lib/agentic-network";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

const downloads = (n: number) => (n > 0 ? n.toLocaleString("en") : "—");

export function ReplacementList({ replacements }: { replacements: Replacement[] }) {
  if (!replacements.length) return <p className="text-sm text-muted-foreground">None we could verify. A wrong successor is worse than none.</p>;
  return (
    <ol className="space-y-4">
      {replacements.map((r) => (
        <li key={r.name} className="paper p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider", r.kind === "alternative" ? "border-border text-muted-foreground" : "border-primary bg-primary/10 text-primary")}>{KIND_LABEL[r.kind]}</span>
            <h3 className="font-semibold">{r.name}</h3>
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border bg-card p-2.5 text-xs leading-relaxed">{r.how}</pre>
          <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Credentials:</span> {r.credentials}</p>
          <p className="mt-1 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Maintained:</span> {r.maintained}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {r.evidence.map((u) => (
              <a key={u} className="inline-flex items-center gap-1 text-primary hover:underline" href={u} target="_blank" rel="noreferrer nofollow">
                {safeHost(u)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ))}
          </p>
        </li>
      ))}
    </ol>
  );
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/** Archived MCP servers and what to use instead: the list, or one server. */
export function InsteadPage({ id }: { id: string | null }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copySnippet = (key: string, markdown: string) => {
    void navigator.clipboard?.writeText(markdown).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2200);
    });
  };
  const row = id ? abandonedServerById(id) : null;
  if (id && !row) {
    return (
      <Shell>
        <p className="display text-2xl">No archived server by that name in the table.</p>
        <a className="mt-3 inline-flex items-center gap-1 text-primary hover:underline" href={href("/instead")}>All archived MCP servers <ArrowRight className="h-3.5 w-3.5" /></a>
      </Shell>
    );
  }
  if (row) {
    const verb = row.status === "archived" ? "is archived" : "looks abandoned";
    const primaryPkgSpec = row.packages[0]
      ? row.packages[0].registry === "pypi"
        ? `pypi:${row.packages[0].name}`
        : row.packages[0].name
      : row.server;
    const rescueMarkdown = buildRescueMarkdownSnippet({
      serverOrPackage: row.packages[0]?.name ?? row.server,
      statusLabel: row.status,
      packageSpec: primaryPkgSpec,
      replacementName: row.replacements[0]?.name ?? null,
      replacementHow: row.replacements[0]?.how ?? null,
      detailsPath: `/instead/${row.id}`,
    });
    return (
      <Shell>
        <a href={href("/instead")} className="text-sm text-muted-foreground hover:text-foreground">← All archived MCP servers</a>
        <p className="eyebrow mt-4">What works instead · checked {SUCCESSORS_CHECKED_AT}</p>
        <h1 className="display mt-2 text-3xl font-semibold sm:text-4xl">{row.server} MCP server {verb}: what to use instead</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{row.summary} <a className="text-primary hover:underline" href={row.statusEvidence} target="_blank" rel="noreferrer nofollow">Source</a>.</p>
        <section className="mt-6">
          <h2 className="eyebrow">Packages that still install it</h2>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {row.packages.length ? row.packages.map((p) => (
              <li key={`${p.registry}:${p.name}`}>
                {p.registry}:{p.name}{p.latestVersion ? ` ${p.latestVersion}` : ""}{p.weeklyDownloads ? ` · about ${downloads(p.weeklyDownloads)} downloads a week` : ""}
                {p.deprecatedNotice && <span className="block pl-4 text-muted-foreground">deprecation notice: “{p.deprecatedNotice}”</span>}
              </li>
            )) : <li>No published package; installed from source.</li>}
          </ul>
        </section>
        <section className="mt-8">
          <h2 className="eyebrow">Use instead</h2>
          <div className="mt-3"><ReplacementList replacements={row.replacements} /></div>
          {row.note && <p className="mt-4 border-l-2 border-primary pl-3 text-sm">{row.note}</p>}
        </section>
        <p className="mt-8 font-mono text-[11px] text-muted-foreground">Every replacement was found and then independently re-checked from the vendor's or maintainer's own pages. Agents: GET /api/shelter/instead/{row.id} or the MCP tool check_package.</p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {row.packages[0] && (
            <a
              href={href(buildWorkbenchSharePath("mcp-rescue", primaryPkgSpec))}
              className="inline-flex min-h-10 items-center gap-1.5 border border-primary/50 bg-primary/10 px-3.5 py-2 font-mono text-xs uppercase tracking-wider text-primary hover:bg-primary hover:text-primary-foreground"
            >
              <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
              Run live migration chain in Node Workbench →
            </a>
          )}
          <button
            type="button"
            onClick={() => copySnippet(`detail-${row.id}`, rescueMarkdown)}
            className="inline-flex min-h-10 items-center gap-1.5 border border-border bg-card px-3.5 py-2 font-mono text-xs uppercase tracking-wider text-foreground hover:border-primary/60 hover:text-primary"
          >
            {copiedKey === `detail-${row.id}` ? (
              <>
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Copied rescue Markdown
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Copy rescue reply / Markdown
              </>
            )}
          </button>
        </div>
        <div className="mt-10">
          <AgenticStudiosBand compact heading="Build with Neural Deep Agentic Studios" />
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <p className="eyebrow">What works instead</p>
      <h1 className="display mt-2 text-3xl font-semibold sm:text-4xl">Archived MCP servers and what to use instead</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {ABANDONED_SERVERS.length} servers that people still install although nobody maintains them, each with replacements verified from the vendor's or maintainer's own pages (checked {SUCCESSORS_CHECKED_AT}). For any other package, run the <a className="text-primary hover:underline" href={href("/check")}>rescue check</a>.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr><th className="py-2 pr-3">Server</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Use instead</th><th className="py-2 pr-3 text-right">Downloads/wk</th><th className="py-2 text-right">Share / Node</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ABANDONED_SERVERS.map((s) => {
              const pkgSpec = s.packages[0]
                ? s.packages[0].registry === "pypi"
                  ? `pypi:${s.packages[0].name}`
                  : s.packages[0].name
                : s.server;
              const md = buildRescueMarkdownSnippet({
                serverOrPackage: s.packages[0]?.name ?? s.server,
                statusLabel: s.status,
                packageSpec: pkgSpec,
                replacementName: s.replacements[0]?.name ?? null,
                replacementHow: s.replacements[0]?.how ?? null,
                detailsPath: `/instead/${s.id}`,
              });
              return (
                <tr key={s.id}>
                  <td className="py-2.5 pr-3"><a className="font-semibold text-primary hover:underline" href={href(`/instead/${s.id}`)}>{s.server}</a></td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{s.status}</td>
                  <td className="py-2.5 pr-3">{s.replacements[0] ? <>{s.replacements[0].name} <span className="text-xs text-muted-foreground">({KIND_LABEL[s.replacements[0].kind]})</span></> : <span className="text-muted-foreground">none verified</span>}</td>
                  <td className="py-2.5 pr-3 text-right font-mono text-xs">{downloads(s.packages.reduce((n, p) => n + (p.weeklyDownloads ?? 0), 0))}</td>
                  <td className="py-2.5 text-right font-mono text-[11px]">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {s.packages[0] && (
                        <a
                          href={href(buildWorkbenchSharePath("mcp-rescue", pkgSpec))}
                          className="border border-primary/40 bg-primary/10 px-2 py-1 text-primary hover:bg-primary hover:text-primary-foreground"
                          title="Open in Free Node Workbench"
                        >
                          Node
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => copySnippet(`row-${s.id}`, md)}
                        className="border border-border px-2 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground"
                        title="Copy helpful Markdown reply with verified replacement + runnable node chain"
                      >
                        {copiedKey === `row-${s.id}` ? "Copied" : "Copy MD"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-6 font-mono text-[11px] text-muted-foreground">JSON for agents and registries: GET /api/shelter/instead</p>
      <div className="mt-10">
        <AgenticStudiosBand compact heading="Build with Neural Deep Agentic Studios" />
      </div>
    </Shell>
  );
}
