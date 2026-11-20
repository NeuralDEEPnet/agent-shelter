import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { Shell } from "@/components/shelter/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { href, navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

type Check = {
  registry: "npm" | "pypi"; name: string; verdict: "sheltered" | "moved" | "abandoned" | "gone" | "stale" | "maintained" | "unknown" | "not-found";
  successor: { name: string | null; url: string | null; exists: boolean | null; note: string } | null;
  daysSinceRelease: number | null;
  headline: string; signals: string[]; latestVersion: string | null; description: string | null; license: string | null;
  registryUrl: string; install: string; repository: string | null;
  resident: { slug: string; name: string; status: string } | null;
  links: { page: string; resume: string | null; badge: string | null; successor: string | null; surrender: string | null };
};

const VERDICT_LABEL: Record<Check["verdict"], string> = { sheltered: "Sheltered", moved: "Moved", abandoned: "Abandoned", gone: "Gone", stale: "Stale", maintained: "Looked after", unknown: "Unknown", "not-found": "Not found" };
const EXAMPLES = [{ registry: "npm", name: "@anaisbetts/mcp-installer" }, { registry: "npm", name: "@modelcontextprotocol/sdk" }, { registry: "pypi", name: "office-word-mcp-server" }];

function readQuery(): { registry: "npm" | "pypi"; name: string } {
  const p = new URLSearchParams(window.location.search);
  return { registry: p.get("registry") === "pypi" ? "pypi" : "npm", name: (p.get("name") ?? "").trim() };
}

/** Rescue check: is this MCP package still looked after — and if not, park it here. */
export function CheckPage() {
  const [q, setQ] = useState(readQuery);
  const [registry, setRegistry] = useState(q.registry);
  const [name, setName] = useState(q.name);
  useEffect(() => { const next = readQuery(); setQ(next); setRegistry(next.registry); setName(next.name); }, []);
  const check = useQuery({
    queryKey: ["rescue-check", q.registry, q.name],
    enabled: Boolean(q.name),
    retry: false,
    queryFn: async (): Promise<Check> => {
      const res = await fetch(`/api/shelter/check?registry=${q.registry}&name=${encodeURIComponent(q.name)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.verdict) throw new Error(body?.detail ?? "The check could not be completed. Try again in a minute.");
      return body as Check;
    },
  });
  const run = (r: "npm" | "pypi", n: string) => {
    const clean = n.trim();
    if (!clean) return;
    setRegistry(r); setName(clean); setQ({ registry: r, name: clean });
    navigate(`/check?registry=${r}&name=${encodeURIComponent(clean)}`);
  };
  const c = check.data;
  const surrenderHref = c?.links.surrender ? href(`/surrender?kind=package&registry=${c.registry}&name=${encodeURIComponent(c.name)}`) : null;
  return (
    <Shell>
      <p className="eyebrow">Rescue check</p>
      <h1 className="display mt-2 text-3xl font-semibold sm:text-4xl">Is this MCP server still looked after?</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Type an npm or PyPI package. We read what the registry publishes about it — deprecation notice, last release, archived repository — and tell you whether it is maintained, stale, abandoned, or already living here. Nothing is installed or run. If nobody looks after it, park it at the shelter for free: it gets a page, an install line and an archive-desk agent that answers questions about it.
      </p>
      <form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); run(registry, name); }}>
        <label>
          <span className="sr-only">Registry</span>
          <select value={registry} onChange={(e) => setRegistry(e.target.value === "pypi" ? "pypi" : "npm")} className="h-11 w-full border border-border bg-background px-3 font-mono text-xs sm:w-28">
            <option value="npm">npm</option>
            <option value="pypi">PyPI</option>
          </select>
        </label>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Package name</span>
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={214} placeholder="package name, e.g. @scope/some-mcp-server" className="h-11 pl-9 font-mono" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
        <Button type="submit" disabled={!name.trim() || check.isFetching} className="h-11 bg-primary px-5 font-mono text-xs uppercase tracking-wider text-primary-foreground">Check</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="py-1">Try:</span>
        {EXAMPLES.map((e) => <button key={e.name} type="button" onClick={() => run(e.registry as "npm" | "pypi", e.name)} className="border border-border px-2 py-1 hover:border-primary hover:text-foreground">{e.name}</button>)}
      </div>

      <div className="mt-8" aria-live="polite">
        {check.isFetching && <p className="font-mono text-sm text-muted-foreground">Reading the registry…</p>}
        {check.isError && !check.isFetching && <div className="paper p-5"><p className="text-sm text-destructive">{check.error.message}</p></div>}
        {c && !check.isFetching && (
          <article className="paper p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("border px-2 py-1 font-mono text-xs uppercase tracking-wider", c.verdict === "maintained" ? "border-border text-muted-foreground" : "border-primary bg-primary/10 text-primary")}>{VERDICT_LABEL[c.verdict]}</span>
              <h2 className="display break-all text-xl font-semibold">{c.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{c.registry}{c.latestVersion ? ` · ${c.latestVersion}` : ""}{c.license ? ` · ${c.license}` : ""}</span>
            </div>
            <p className="mt-3 text-base">{c.headline}</p>
            {c.description && <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>}
            {c.signals.length > 0 && <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{c.signals.map((s) => <li key={s}>{s}</li>)}</ul>}
            <div className="mt-5 flex flex-wrap gap-3">
              {c.successor?.name && <Button asChild className="bg-primary font-mono text-xs uppercase tracking-wider text-primary-foreground"><a href={href(`/check?registry=${c.registry}&name=${encodeURIComponent(c.successor.name)}`)} onClick={(e) => { e.preventDefault(); run(c.registry, c.successor!.name!); }}>Check {c.successor.name} <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></a></Button>}
              {!c.successor?.name && c.successor?.url && <Button asChild variant="outline" className="font-mono text-xs uppercase tracking-wider"><a href={c.successor.url} target="_blank" rel="noreferrer nofollow">What the maintainer says to use</a></Button>}
              {c.resident && <Button asChild className="bg-primary font-mono text-xs uppercase tracking-wider text-primary-foreground"><a href={href(`/r/${c.resident.slug}`)}>Ask {c.resident.name} — free <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></a></Button>}
              {surrenderHref && <Button asChild className="bg-primary font-mono text-xs uppercase tracking-wider text-primary-foreground"><a href={surrenderHref}>Park it at the shelter — free <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></a></Button>}
              {!["not-found", "gone"].includes(c.verdict) && <Button asChild variant="outline" className="font-mono text-xs uppercase tracking-wider"><a href={c.registryUrl} target="_blank" rel="noreferrer">Registry page</a></Button>}
            </div>
            {c.links.badge && c.links.resume && (
              <div className="mt-5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">README badge</p>
                <pre className="mt-1 overflow-x-auto border bg-card p-3 text-xs">{`[![Agent Shelter](${c.links.badge})](${c.links.resume})`}</pre>
              </div>
            )}
            <p className="mt-5 font-mono text-[11px] text-muted-foreground">Public registry signals only; not a statement about code quality. Agents: MCP tool <code>check_package</code> or GET /api/shelter/check.</p>
          </article>
        )}
      </div>
    </Shell>
  );
}
