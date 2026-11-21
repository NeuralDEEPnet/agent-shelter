import { ArrowUpRight, Box, Cpu, Globe, Palette } from "lucide-react";
import { AGENTIC_STUDIOS, type AgenticStudio, type StudioId } from "@/lib/agentic-network";
import { cn } from "@/lib/utils";

function StudioIcon({ id, className }: { id: StudioId; className?: string }) {
  switch (id) {
    case "3dj":
      return <Box className={className} aria-hidden="true" />;
    case "sketchmonkey":
      return <Palette className={className} aria-hidden="true" />;
    case "aibeing":
      return <Cpu className={className} aria-hidden="true" />;
    case "dreamscape":
      return <Globe className={className} aria-hidden="true" />;
  }
}

/**
 * Compact top-bar switcher linking Agent Shelter (`shelter.neuraldeep.net`) directly
 * to the live Neural Deep Agentic Studios without adding horizontal page overflow at 390px.
 */
export function AgenticNetworkStrip() {
  return (
    <div className="border-b border-border/70 bg-card/75 text-xs">
      <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-1.5 font-mono [&>*]:shrink-0">
        <a
          href="https://neuraldeep.net"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-7 items-center gap-1.5 pr-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <span className="h-1.5 w-1.5 bg-primary" aria-hidden="true" />
          Neural Deep Network
        </a>
        <span className="text-border" aria-hidden="true">/</span>
        <span className="border border-primary/45 bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Agent Shelter
        </span>
        {AGENTIC_STUDIOS.map((s) => (
          <a
            key={s.id}
            href={s.baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-7 items-center gap-1 border border-transparent px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/60 hover:text-foreground"
            title={`${s.name} — ${s.roleLabel}`}
          >
            <StudioIcon id={s.id} className="h-3 w-3 text-primary" />
            <span>{s.shortName}</span>
            <ArrowUpRight className="h-2.5 w-2.5 opacity-70" aria-hidden="true" />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Full 4-card portal band routing visitors, developers, and AI crawlers from
 * Agent Shelter straight into our connected production Agentic Studios.
 */
export function AgenticStudiosBand({
  brief,
  compact = false,
  selectedId,
  heading = "Connected Neural Deep Agentic Studios",
}: {
  brief?: string;
  compact?: boolean;
  selectedId?: StudioId | null;
  heading?: string;
}) {
  return (
    <section className="mb-8" aria-labelledby="agentic-studios-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="agentic-studios-heading" className="eyebrow text-xs">
            {heading}
          </h2>
          {!compact && (
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Draft specs and rescue tools here for free, then jump in one click to build CAD solids, industrial renders, AI employees, or 3D worlds.
            </p>
          )}
        </div>
        <a
          href="https://neuraldeep.net"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] uppercase tracking-wider text-primary hover:underline"
        >
          neuraldeep.net ecosystem →
        </a>
      </div>
      <div className={cn("grid gap-3 sm:grid-cols-2", compact ? "lg:grid-cols-4" : "xl:grid-cols-4")}>
        {AGENTIC_STUDIOS.map((studio) => (
          <StudioPortalCard key={studio.id} studio={studio} brief={brief} compact={compact} highlighted={selectedId === studio.id} />
        ))}
      </div>
    </section>
  );
}

function StudioPortalCard({
  studio,
  brief,
  compact,
  highlighted,
}: {
  studio: AgenticStudio;
  brief?: string;
  compact: boolean;
  highlighted: boolean;
}) {
  const targetHref = studio.buildHandoffUrl(brief);
  return (
    <a
      href={targetHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "paper group flex min-w-0 flex-col justify-between p-4 transition-colors hover:border-primary",
        highlighted ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="border border-primary/35 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
            {studio.badge}
          </span>
          <StudioIcon id={studio.id} className="h-4 w-4 shrink-0 text-primary" />
        </div>
        <h3 className="display mt-2.5 text-base font-semibold text-foreground group-hover:text-primary">
          {studio.shortName}
        </h3>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{studio.domainLabel}</p>
        {!compact && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{studio.summary}</p>}
      </div>
      <span className="mt-3.5 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-primary">
        {studio.ctaLabel}
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
      </span>
    </a>
  );
}
