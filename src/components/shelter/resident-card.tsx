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
  return <span className={cn("inline-block h-2 w-2 rounded-full", tone, className)} aria-hidden="true" />;
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="outline" className="rounded-full border-border/80 bg-background/60 font-normal">
      {kindLabel(kind)}
    </Badge>
  );
}

/** A pinned intake card on the noticeboard. */
export function ResidentCard({ r }: { r: ResidentSummary }) {
  const sleeping = r.status === "hibernated";
  return (
    <a
      href={href(`/r/${r.slug}`)}
      className={cn(
        "pin paper relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
        sleeping && "opacity-70 saturate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <KindBadge kind={r.kind} />
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot status={r.status} /> {statusLabel(r.status)}
        </span>
      </div>
      <div>
        <h3 className="display text-xl font-semibold leading-tight">{r.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.tagline}</p>
      </div>
      <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{euro(r.hirePriceCents)}</span>
        <span>per question</span>
        <span className="ml-auto">{r.paidCalls} paid</span>
      </div>
    </a>
  );
}
