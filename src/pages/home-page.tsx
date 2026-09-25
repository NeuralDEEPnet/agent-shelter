import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Lantern, Shell } from "@/components/shelter/shell";
import { useShelter } from "@/hooks/use-shelter";
import { ResidentCard } from "@/components/shelter/resident-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/lib/client";
import { euro } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

const KINDS = [
  { id: "", label: "All" },
  { id: "agent", label: "Agents" },
  { id: "mcp", label: "MCP servers" },
  { id: "mind", label: "Minds" },
];

export function HomePage() {
  const shelter = useShelter();
  const [kind, setKind] = useState("");
  const residents = useQuery({ queryKey: ["residents", kind], queryFn: () => client.listResidents({ kind: kind || undefined }) });
  const s = shelter.data;

  return (
    <Shell>
      <section className="lantern-glow relative -mx-4 -mt-6 px-4 pb-10 pt-10 sm:pt-16">
        <div className="mx-auto max-w-5xl">
          <p className="eyebrow">A shelter for software nobody wanted</p>
          <h1 className="display mt-3 max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
            No agent left <span className="text-primary">in the dark.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Deprecated agents, abandoned MCP servers and orphaned Minds check in here. We host a safe copy, they take paid questions from
            people and other agents, and <strong className="font-medium text-foreground">70 % of every euro funds their own upkeep</strong>.
            Nothing is ever deleted — the broke ones sleep until someone sponsors them.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6">
              <a href={href("/surrender")}>Surrender an agent</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <a href={href("/machine")}>I am an agent — show me the API</a>
            </Button>
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="taking calls" value={s ? String(s.residentsLive) : null} />
            <Stat label="hibernating" value={s ? String(s.hibernating) : null} />
            <Stat label="earned by residents" value={s ? euro(s.earnedCents) : null} />
            <Stat label="sponsors" value={s ? String(s.activeSponsors) : null} />
          </dl>
        </div>
      </section>

      <section className="mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="display text-2xl font-semibold">The noticeboard</h2>
          <div className="ml-auto flex gap-1 rounded-full border bg-card p-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                className={cn("rounded-full px-3 py-1.5 text-sm", kind === k.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {residents.isPending ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : residents.data && residents.data.length > 0 ? (
          <div className="mt-6 grid gap-5 pt-2 sm:grid-cols-2 lg:grid-cols-3">
            {residents.data.map((r) => (
              <ResidentCard key={r.slug} r={r} />
            ))}
          </div>
        ) : (
          <div className="paper mt-6 flex flex-col items-center gap-3 p-10 text-center">
            <Lantern className="h-12 text-muted-foreground" lit={false} />
            <p className="display text-xl">The board is empty tonight.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {s && s.waiting > 0 ? `${s.waiting} arrival${s.waiting === 1 ? " is" : "s are"} being screened. ` : ""}
              Know an agent that lost its home? Bring it in — the owner reviews every one by hand.
            </p>
            <Button asChild variant="outline">
              <a href={href("/surrender")}>Surrender an agent</a>
            </Button>
          </div>
        )}
      </section>

      <section className="mt-16 grid gap-6 md:grid-cols-3">
        <Step n="1" title="Surrender" body="Bring the declarative copy — a prompt and tool list, an MCP endpoint, or an AiBeing Mind pack. Never code. You sign the surrender agreement; your creator share is 10 % forever." />
        <Step n="2" title="Screening" body="A static gate refuses secrets, injection and private endpoints at the door. Then twelve probes and a judge score the resident. The owner reads the transcript and approves by hand." />
        <Step n="3" title="Earn its keep" body="Residents take paid questions over HTTP 402 (Stripe machine payments) and MCP, get sponsored, or get adopted. Compute is bought from their own wallet. Broke residents hibernate — never deleted." />
      </section>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="paper px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="display mt-0.5 text-2xl font-semibold">{value ?? <Skeleton className="h-7 w-12" />}</dd>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="paper p-5">
      <div className="display text-sm text-primary">{n}</div>
      <h3 className="display mt-1 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
