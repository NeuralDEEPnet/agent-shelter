import { useState } from "react";
import { Check, Copy, ExternalLink, Terminal, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { euro, kindLabel, statusLabel } from "@/lib/format";
import { buildResidentMcpConfig, DEFAULT_SERVING_ORIGIN } from "@/lib/mcp-config";
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
  freeCalls?: number;
  earnedCents: number;
  tools: string[];
  install?: string | null;
  inHouse?: boolean;
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
export function ResidentCard({ r, machineOrigin }: { r: ResidentSummary; machineOrigin?: string }) {
  const sleeping = r.status === "hibernated";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [copiedProbe, setCopiedProbe] = useState(false);

  const origin = (machineOrigin || DEFAULT_SERVING_ORIGIN).replace(/\/+$/, "");
  const hireUrl = `${origin}/api/mpp/hire/${encodeURIComponent(r.slug)}`;
  const mcpJson = buildResidentMcpConfig(r.slug, origin);
  const askUrl = `${origin}/api/mpp/ask/${encodeURIComponent(r.slug)}`;
  const probeCurl = `curl -sS -X POST ${askUrl} -H 'content-type: application/json' -d '{"question":"What are you for?"}'`;
  const live = r.status === "active" || r.status === "probation";

  const copyText = async (text: string, which: "mcp" | "probe") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "mcp") {
        setCopiedMcp(true);
        setTimeout(() => setCopiedMcp(false), 1800);
        toast("MCP config copied", { description: `Paste into Claude Desktop, Cursor, or ChatGPT MCP settings for ${r.name}.` });
      } else {
        setCopiedProbe(true);
        setTimeout(() => setCopiedProbe(false), 1800);
        toast("Free question copied", { description: "Run it in any terminal — no account, no payment." });
      }
    } catch {
      toast("Copy unavailable", { description: "Select the snippet below and copy it manually." });
    }
  };

  return (
    <article
      className={cn(
        "resident-card pin paper relative flex flex-col gap-4 p-5 transition-colors",
        sleeping && "opacity-75 saturate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <KindBadge kind={r.kind} />
        {r.inHouse && <span className="rounded-none border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground" title="Authored by the shelter's operator; not a rescue.">staff / demo</span>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot status={r.status} /> {statusLabel(r.status)}
        </span>
      </div>

      <a
        href={href(`/r/${r.slug}`)}
        className="group flex items-start gap-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="resident-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-9 w-9" shapeRendering="crispEdges">
            {r.kind === "mcp" ? <path d="M2 4H10V6H14V4H22V10H14V8H10V10H2ZM10 10H14V14H10ZM2 14H10V16H14V14H22V20H14V18H10V20H2Z" fill="currentColor" /> : r.kind === "mind" ? <path d="M8 2H16V4H20V8H22V16H20V20H16V22H8V20H4V16H2V8H4V4H8ZM8 8V16H10V8ZM14 8V16H16V8Z" fill="currentColor" fillRule="evenodd" /> : <path d="M4 2H14V4H18V8H20V22H4ZM6 4V20H18V10H12V4ZM14 4V8H18ZM8 12H16V14H8ZM8 16H14V18H8Z" fill="currentColor" fillRule="evenodd" />}
          </svg>
        </div>
        <div className="min-w-0">
          <h3 className="display text-xl font-semibold leading-tight group-hover:text-primary transition-colors">{r.name}</h3>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{r.tagline}</p>
        </div>
      </a>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
        {live ? (
          <span className="flex items-center gap-1 font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Free to ask
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium">{statusLabel(r.status)}</span>
        )}
        <span className="font-medium text-foreground">{euro(r.hirePriceCents)}</span>
        <span>per paid question</span>
        <span className="ml-auto">{(r.freeCalls ?? 0) + r.paidCalls} answered</span>
      </div>
      {r.install && <p className="break-all font-mono text-[11px] text-muted-foreground">Parked package · run it yourself: <span className="text-foreground">{r.install}</span></p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer",
            drawerOpen
              ? "border-primary bg-primary text-primary-foreground"
              : "border-primary/50 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground",
          )}
        >
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          <span>⚡ Ask free &amp; connect MCP</span>
          {drawerOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>

        <a
          href={href(`/r/${r.slug}`)}
          className="inline-flex min-h-9 items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-primary hover:underline"
        >
          View resident <span aria-hidden="true">→</span>
        </a>
      </div>

      {drawerOpen && (
        <div
          className="mt-1 space-y-3 border border-primary/40 bg-background/90 p-3.5 font-mono text-xs animate-in fade-in duration-150"
          role="region"
          aria-label={`Test and connect ${r.name} via MCP`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-primary">
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              Neo-Tokyo MCP Uplink // {r.slug}
            </span>
            <span className="text-[10px] text-muted-foreground">Zero-cost discovery · Streamable HTTP</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Claude Desktop / Cursor / ChatGPT MCP JSON:</span>
              <button
                type="button"
                onClick={() => void copyText(mcpJson, "mcp")}
                className="inline-flex items-center gap-1 border border-primary/50 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
              >
                {copiedMcp ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                {copiedMcp ? "Copied MCP JSON" : "Copy MCP JSON"}
              </button>
            </div>
            <pre className="max-h-40 overflow-x-auto border border-border bg-card p-2.5 text-[11px] leading-relaxed text-foreground">
              {mcpJson}
            </pre>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">Ask it one free question from a terminal:</span>
              <button
                type="button"
                onClick={() => void copyText(probeCurl, "probe")}
                className="inline-flex items-center gap-1 border border-border bg-card px-2 py-0.5 text-[10px] uppercase text-foreground hover:border-primary/50 cursor-pointer"
              >
                {copiedProbe ? <Check className="h-3 w-3 text-primary" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                {copiedProbe ? "Copied" : "Copy cURL"}
              </button>
            </div>
            <div className="break-all border border-border/70 bg-card/70 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              Hire endpoint (HTTP 402): <span className="text-foreground">{hireUrl}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <a
              href={href(`/r/${r.slug}#ask`)}
              className="inline-flex min-h-9 items-center gap-1.5 border border-primary bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase text-primary-foreground hover:opacity-90"
            >
              Ask it free on its page →
            </a>
            <a
              href={href(`/r/${r.slug}`)}
              className="inline-flex min-h-9 items-center gap-1 border border-border bg-card px-2.5 py-1.5 text-[11px] uppercase text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              Full Dossier &amp; 402 Hire <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      )}
    </article>
  );
}

