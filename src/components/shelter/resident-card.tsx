import { Badge } from "@/components/ui/badge";
import { euro, kindLabel, statusLabel } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

export type ResidentSummary = {
  slug: string;
  kind: string;
  name: string;
  tagline: string;
  status: string;
  hirePriceCents: number;
  paidCalls: number;
  earnedCents: number;
  tools: string[];
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const tone = status === "active" ? "bg-[var(--glow)]" : status === "probation" ? "bg-chart-2" : status === "hibernated" ? "bg-muted-foreground/50" : "bg-muted-foreground";
  return <span className={cn("inline-block h-2 w-2", tone, className)} aria-hidden="true" />;
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="outline" className="rounded-none border-primary/40 bg-background/60 font-mono text-[10px] font-normal uppercase tracking-wide text-primary">
      {kindLabel(kind)}
    </Badge>
  );
}

/** A pixel-styled resident dossier; identity is derived from real resident data. */
export function ResidentCard({ r }: { r: ResidentSummary }) {
  const sleeping = r.status === "hibernated";
  return (
    <a
      href={href(`/r/${r.slug}`)}
      className={cn(
        "resident-card pin paper relative flex flex-col gap-4 p-5 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        sleeping && "opacity-70 saturate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <KindBadge kind={r.kind} />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot status={r.status} /> {statusLabel(r.status)}
        </span>
      </div>
      <div className="flex items-start gap-4">
        <div className="resident-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-9 w-9" shapeRendering="crispEdges">
            {r.kind === "mcp" ? <path d="M2 4H10V6H14V4H22V10H14V8H10V10H2ZM10 10H14V14H10ZM2 14H10V16H14V14H22V20H14V18H10V20H2Z" fill="currentColor" /> : r.kind === "mind" ? <path d="M8 2H16V4H20V8H22V16H20V20H16V22H8V20H4V16H2V8H4V4H8ZM8 8V16H10V8ZM14 8V16H16V8Z" fill="currentColor" fillRule="evenodd" /> : <path d="M4 2H14V4H18V8H20V22H4ZM6 4V20H18V10H12V4ZM14 4V8H18ZM8 12H16V14H8ZM8 16H14V18H8Z" fill="currentColor" fillRule="evenodd" />}
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="display text-xl font-semibold leading-tight">{r.name}</h3>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{r.tagline}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Sponsored
        </span>
        <span className="font-medium text-foreground">{euro(r.hirePriceCents)}</span>
        <span>per question</span>
        <span className="ml-auto">{r.paidCalls} paid</span>
      </div>
      <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary">View resident <span aria-hidden="true">→</span></span>
    </a>
  );
}
