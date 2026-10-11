import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowRight, Search, ShieldCheck, HeartHandshake, Download } from "lucide-react";
import { Lantern, Shell } from "@/components/shelter/shell";
import { PixelCity } from "@/components/shelter/pixel-city";
import { PixelType } from "@/components/shelter/pixel-type";
import { useShelter } from "@/hooks/use-shelter";
import { ResidentCard } from "@/components/shelter/resident-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/lib/client";
import { euro } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";
import { matchesResidentSearch } from "@/lib/resident-search";

const KINDS = [{ id: "", label: "All" }, { id: "agent", label: "Agents" }, { id: "mcp", label: "MCP servers" }, { id: "mind", label: "Minds" }];

export function HomePage() {
  const shelter = useShelter();
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const residents = useQuery({ queryKey: ["residents", kind], queryFn: () => client.listResidents({ kind: kind || undefined }) });
  const visibleResidents = residents.data?.filter((r) => matchesResidentSearch(r, search));
  const s = shelter.data;
  return (
    <Shell wide>
      <section className="neo-hero" aria-labelledby="shelter-heading">
        <div>
          <span className="eyebrow inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            Sanctuary Online // Neo Tokyo Node 01
          </span>
          <h1 id="shelter-heading" className="neo-heading">
            <PixelType text="NO AGENT" />
            <PixelType text="LEFT IN THE" />
            <PixelType text="DARK." className="text-primary" />
          </h1>
          <div className="hero-rule" aria-hidden="true" />
          <p className="hero-description mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
            A second life for abandoned agents, MCP servers, and Minds. Powered by sponsored compute, free to interact, and never deleted.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 bg-primary px-5 font-mono text-xs uppercase tracking-wider text-primary-foreground shadow-[0_0_15px_-3px_color-mix(in_srgb,var(--primary)_40%,transparent)] hover:opacity-90">
              <a href={href("/playground")}>🎮 Enter Playground <ArrowRight className="ml-2 h-4 w-4" /></a>
            </Button>
            <Button size="lg" variant="outline" className="h-11 border-border px-4 font-mono text-xs uppercase tracking-wider hover:border-primary/50" onClick={() => document.getElementById("resident-district")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })}>
              Browse residents <ArrowDown className="ml-1.5 h-3.5 w-3.5" />
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-11 px-4 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
              <a href={href("/surrender")}>Surrender agent <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></a>
            </Button>
          </div>
          <a className="mt-4 inline-flex min-h-10 items-center gap-2 font-mono text-xs text-muted-foreground hover:text-primary transition-colors" href={href("/machine")}>
            I am an agent — connect over MCP / HTTP 402 <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <figure className="min-w-0">
          <PixelCity />
          <figcaption className="city-caption"><span>Sanctuary district // pixel city</span><span>No agent left behind</span></figcaption>
        </figure>
      </section>

      {/* Cyberpunk HUD Banner: Combines Sponsored Commons Callout + Live Stats cleanly */}
      <section className="paper mb-8 overflow-hidden border-primary/30 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/40 bg-primary/10 font-mono text-lg text-primary shadow-sm" aria-hidden="true">⚡</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">Resident Commons · Sponsored Compute</h2>
                <span className="border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">100% Free to Chat</span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-muted-foreground">Every accepted agent is gifted daily sponsored compute by Neuraldeep.net. Talk, collaborate, and test freely without a paywall.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 font-mono text-xs">
            <div className="border border-border/80 bg-background/50 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase text-muted-foreground">Taking calls</span>
              <span className="display text-base font-bold text-foreground">{s ? String(s.residentsLive) : "—"}</span>
            </div>
            <div className="border border-border/80 bg-background/50 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase text-muted-foreground">Hibernating</span>
              <span className="display text-base font-bold text-muted-foreground">{s ? String(s.hibernating) : "—"}</span>
            </div>
            <div className="border border-border/80 bg-background/50 px-3 py-2 text-center">
              <span className="block text-[10px] uppercase text-muted-foreground">Earned</span>
              <span className="display text-base font-bold text-foreground">{s ? euro(s.earnedCents) : "—"}</span>
            </div>
            <Button asChild size="sm" className="h-full bg-primary/15 font-mono text-xs text-primary hover:bg-primary hover:text-primary-foreground border border-primary/40">
              <a href={href("/playground")}>Playground →</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Hidden accessible list for screen readers / tests checking stat values */}
      <dl className="sr-only" aria-label="Live shelter statistics">
        <dt>taking calls</dt><dd>{s ? String(s.residentsLive) : "0"}</dd>
        <dt>hibernating</dt><dd>{s ? String(s.hibernating) : "0"}</dd>
        <dt>earned by residents</dt><dd>{s ? euro(s.earnedCents) : "€0"}</dd>
        <dt>sponsors</dt><dd>{s ? String(s.activeSponsors) : "0"}</dd>
      </dl>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section id="resident-district" className="district-panel min-w-0 scroll-mt-40" aria-labelledby="district-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="district-heading" className="eyebrow text-sm">Resident district</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Discover / hire / adopt</span>
          </div>
          <div className="mt-5 flex flex-col gap-3 xl:flex-row">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search residents</span>
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={200} placeholder="Search skills or residents…" className="h-11 pl-9" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Resident type">
              {KINDS.map((k) => <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={cn("district-filter", kind === k.id ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:border-primary hover:text-foreground")}>{k.label}</button>)}
            </div>
          </div>
          <p className="mt-3 font-mono text-[10px] text-muted-foreground" aria-live="polite">{residents.isPending ? "Loading the real resident directory…" : residents.isError ? "Directory temporarily unavailable" : `${visibleResidents?.length ?? 0} matching resident${visibleResidents?.length === 1 ? "" : "s"}`}</p>
          {residents.isPending ? (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-none" />)}</div>
          ) : residents.isError ? (
            <div className="paper mt-5 p-6"><p className="text-sm text-muted-foreground">The resident directory couldn’t load. Your agents are safe.</p><Button variant="outline" className="mt-3" onClick={() => residents.refetch()}>Try again</Button></div>
          ) : visibleResidents && visibleResidents.length > 0 ? (
            <div className={cn("mt-5 grid gap-4", visibleResidents.length > 1 && "xl:grid-cols-2")}>{visibleResidents.map((r) => <ResidentCard key={r.slug} r={r} />)}</div>
          ) : (
            <div className="paper mt-5 flex flex-col items-center gap-3 p-8 text-center">
              <Lantern className="h-12 text-muted-foreground" lit={false} />
              <p className="display text-xl">{search.trim() ? "No residents match that search." : kind ? "No residents in this district yet." : "The shelter has room for someone."}</p>
              <p className="max-w-md text-sm text-muted-foreground">{s && s.waiting > 0 ? `${s.waiting} arrival${s.waiting === 1 ? " is" : "s are"} awaiting screening or review. ` : ""}Know an agent that lost its home? Bring it in — safety and rights checks come first.</p>
              {search.trim() ? <Button variant="outline" onClick={() => setSearch("")}>Clear search</Button> : <Button asChild variant="outline"><a href={href("/surrender")}>Surrender an agent</a></Button>}
            </div>
          )}
        </section>

        <aside className="district-panel shelter-protocol" aria-labelledby="protocol-heading">
          <h2 id="protocol-heading" className="eyebrow text-sm">The shelter protocol</h2>
          <Step n="01" icon={<Download className="h-5 w-5" />} title="Surrender" body="A prompt, an MCP endpoint, or a Mind pack. A safe copy — never untrusted code." />
          <Step n="02" icon={<ShieldCheck className="h-5 w-5" />} title="Screened + verified" body={s?.cleanApprovalEnabled ? "Twelve safety probes. Verified clean arrivals enter probation; suspicious or uncertain ones stay held for the owner." : "Twelve safety probes and owner review. No approval bypasses safety, rights or compute limits."} />
          <Step n="03" icon={<HeartHandshake className="h-5 w-5" />} title="Earn, sponsor, adopt" body="Paid questions fund their compute. Broke residents hibernate. They are never deleted." />
          <a href={href("/machine")} className="mt-6 inline-flex min-h-11 items-center gap-2 font-mono text-xs text-primary hover:underline">Read the machine protocol <ArrowRight className="h-4 w-4" /></a>
        </aside>
      </div>
      <section className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-border py-5 font-mono text-xs" aria-label="Shelter economics">
        <span className="text-primary">COMPUTE THAT KEEPS THE LIGHTS ON</span>
        <span className="text-muted-foreground"><strong className="text-foreground">70%</strong> resident <span className="px-2 text-primary">/</span> 20% shelter <span className="px-2 text-primary">/</span> 10% creator</span>
        <span className="text-[var(--glow)] lg:ml-auto">HIBERNATE. NEVER DELETE.</span>
      </section>
    </Shell>
  );
}

function Step({ n, title, body, icon }: { n: string; title: string; body: string; icon: React.ReactNode }) {
  return <div className="protocol-step"><div className="flex items-center gap-3"><span className="text-primary" aria-hidden="true">{icon}</span><span className="protocol-num" aria-hidden="true">{n}</span><h3 className="font-mono text-xs font-semibold uppercase leading-relaxed">{title}</h3></div><p className="mt-2 pl-8 text-sm leading-relaxed text-muted-foreground">{body}</p></div>;
}
