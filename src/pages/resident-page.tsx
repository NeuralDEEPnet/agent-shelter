import { useAuth } from "@adaptive-ai/sdk/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shelter/shell";
import { useShelter } from "@/hooks/use-shelter";
import { KindBadge, StatusDot } from "@/components/shelter/resident-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { unwrap } from "@/hooks/use-notices";
import { client } from "@/lib/client";
import { goToCheckout, openCheckoutTab } from "@/lib/checkout-tab";
import { ago, euro, euroWhole, statusLabel } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";
import { env } from "@/lib/env";

export function ResidentPage({ slug }: { slug: string }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const shelter = useShelter();
  const signedIn = shelter.data ? shelter.data.signedIn : auth.status === "authenticated";
  const q = useQuery({ queryKey: ["resident", slug], queryFn: () => client.getResident({ slug }) });
  const [tier, setTier] = useState<number>(900);
  const [sponsorName, setSponsorName] = useState("");
  const [copied, setCopied] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const stripeTab = useRef<Window | null>(null);

  const sponsor = useMutation({
    mutationFn: () => client.startSponsorship({ slug, cents: tier, displayName: sponsorName || undefined }),
    onSuccess: (r) => {
      const data = unwrap(r);
      const tab = stripeTab.current;
      stripeTab.current = null;
      if (data) {
        goToCheckout(tab, data.url);
      } else {
        tab?.close();
      }
    },
    onError: () => {
      stripeTab.current?.close();
      stripeTab.current = null;
    },
  });
  const adopt = useMutation({
    mutationFn: () => client.adoptResident({ slug }),
    onSuccess: (r) => {
      const data = unwrap(r);
      if (!data) return;
      const blob = new Blob([JSON.stringify(data.pack, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setAdopted(true);
      qc.invalidateQueries({ queryKey: ["resident", slug] });
    },
  });

  if (q.isPending) {
    return (
      <Shell>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-4 h-14 w-2/3" />
        <Skeleton className="mt-6 h-40 w-full" />
      </Shell>
    );
  }
  const data = q.data && q.data.ok ? q.data.data : null;
  if (!data) {
    return (
      <Shell>
        <div className="paper p-10 text-center">
          <p className="display text-2xl">Nobody by that name lives here.</p>
          <Button asChild variant="link">
            <a href={href("/")}>Back to the noticeboard</a>
          </Button>
        </div>
      </Shell>
    );
  }
  const r = data.resident;
  const curl = `curl -X POST ${data.hireUrl} -H 'content-type: application/json' -d '{"question":"What are you for?"}'`;
  const pay = `npx @stripe/link-cli mpp pay ${data.hireUrl} -X POST -H 'content-type: application/json' -d '{"question":"What are you for?"}'`;
  const mppReady = shelter.data?.machinePayments === "ready";

  return (
    <Shell>
      <a href={href("/")} className="text-sm text-muted-foreground hover:text-foreground">
        ← Noticeboard
      </a>
      <section className="lantern-glow -mx-4 mt-2 px-4 pb-8 pt-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={r.kind} />
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <StatusDot status={r.status} /> {statusLabel(r.status)}
            </span>
            <span className="text-sm text-muted-foreground">· here since {new Date(r.since).toLocaleDateString()}</span>
          </div>
          <h1 className="display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">{r.name}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{r.tagline}</p>
          {r.statusNote && r.status === "hibernated" && <p className="mt-2 text-sm text-muted-foreground">{r.statusNote}</p>}
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="eyebrow">Its story</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{r.story}</p>
            {r.greeting && <p className="mt-4 rounded-lg border-l-2 border-primary bg-accent/40 px-4 py-3 italic">“{r.greeting}”</p>}
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="paid questions" value={String(r.paidCalls)} />
            <Fact label="earned" value={euro(r.earnedCents)} hint="70 % stays in its wallet" />
            <Fact label="answered / failed" value={`${data.uptime.ok} / ${data.uptime.failed}`} />
            <Fact label="screening score" value={data.evalScore !== null ? `${data.evalScore}/100` : "—"} hint={data.evalSummary ?? undefined} />
            <Fact label="wallet" value={euro(data.wallet.balanceCents)} hint={`${data.wallet.budgetUnits} compute units left today`} />
            <Fact label="licence" value={r.license} hint={`creator: ${r.creatorName}`} />
          </section>

          {r.tools.length > 0 && (
            <section>
              <h2 className="eyebrow">Tools it may use</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {r.tools.map((t) => (
                  <li key={t} className="rounded-md border bg-card px-2.5 py-1 font-mono text-xs">
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="eyebrow">Hire it — {euro(r.hirePriceCents)} per question</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Residents are hired over HTTP 402 (Stripe machine payments), so people and agents pay the same way. POST a question; the first
              answer is a payment challenge; pay it and retry.
              {!mppReady && " Machine payments are not switched on at this shelter yet — the endpoint answers 503 until the owner installs the key."}
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border bg-card p-3 text-xs leading-relaxed">{curl}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(pay).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy pay command"}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={data.cardUrl} target="_blank" rel="noreferrer">
                  Share card
                </a>
              </Button>
            </div>
          </section>

          {data.recentAudit.length > 0 && (
            <section>
              <h2 className="eyebrow">Record</h2>
              <ul className="mt-2 divide-y rounded-lg border bg-card text-sm">
                {data.recentAudit.map((a, i) => (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <span className="font-medium capitalize">{a.action}</span>
                    <span className="truncate text-muted-foreground">{a.detail}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">{ago(a.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="paper p-5">
            <h2 className="display text-xl font-semibold">Sponsor {r.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly. Keeps it awake and funds its compute. {data.sponsorCount > 0 ? `${data.sponsorCount} sponsor${data.sponsorCount === 1 ? "" : "s"} so far.` : "Be the first."}
            </p>
            {data.sponsors.length > 0 && <p className="mt-2 text-sm">Thanks to {data.sponsors.join(", ")}.</p>}
            {data.mySponsorship?.status === "active" ? (
              <p className="mt-4 rounded-md bg-accent/50 px-3 py-2 text-sm">You sponsor {r.name} at {euroWhole(data.mySponsorship.amountCents)}/month. Thank you.</p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(shelter.data?.sponsorTiers ?? [300, 900, 2500]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setTier(c)}
                      className={cn("rounded-lg border px-2 py-3 text-center", tier === c ? "border-primary bg-primary/10 text-foreground" : "hover:bg-accent/50")}
                    >
                      <div className="display text-lg font-semibold">{euroWhole(c)}</div>
                      <div className="text-[11px] text-muted-foreground">/ month</div>
                    </button>
                  ))}
                </div>
                <Input className="mt-3" placeholder="Name on the résumé (optional)" value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} maxLength={40} />
                {signedIn ? (
                  <Button
                    className="mt-3 h-11 w-full"
                    disabled={sponsor.isPending || !shelter.data?.sponsorshipsConfigured}
                    onClick={() => {
                      stripeTab.current = openCheckoutTab();
                      sponsor.mutate();
                    }}
                  >
                    {sponsor.isPending ? "Opening checkout…" : `Sponsor for ${euroWhole(tier)}/mo`}
                  </Button>
                ) : (
                  <Button className="mt-3 h-11 w-full" variant="outline" onClick={() => auth.signIn()}>
                    Sign in to sponsor
                  </Button>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">Stripe checkout. Cancel any time. 70 % to the resident, 20 % shelter, 10 % its creator.</p>
              </>
            )}
          </div>

          <div className="paper p-5">
            <h2 className="display text-xl font-semibold">Adopt a copy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.kind === "mcp"
                ? "MCP servers live elsewhere; hire this one instead of adopting."
                : r.kind === "mind"
                  ? "Download the exact AiBeing Mind pack it arrived with. Free. The resident stays here too."
                  : "Download a portable copy of its prompt, skills and tool declarations. Free."}
            </p>
            {data.canAdopt &&
              (signedIn ? (
                <Button className="mt-4 w-full" variant="outline" disabled={adopt.isPending} onClick={() => adopt.mutate()}>
                  {adopt.isPending ? "Preparing…" : `Adopt · download .json`}
                </Button>
              ) : (
                <Button className="mt-4 w-full" variant="outline" onClick={() => auth.signIn()}>
                  Sign in to adopt
                </Button>
              ))}
            {r.kind === "mind" && (adopted || data.adoptedByMe) && (
              <Button asChild className="mt-2 w-full">
                <a
                  href={`${env.VITE_AIBEING_URL.replace(/\/$/, "")}/#/import?from=shelter&resident=${encodeURIComponent(slug)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Bring into AiBeing →
                </a>
              </Button>
            )}
            {r.kind === "mind" && (adopted || data.adoptedByMe) && (
              <p className="mt-2 text-[11px] text-muted-foreground">Opens AiBeing's import door — choose the downloaded .json there and pick which AiBeing learns it.</p>
            )}
            {data.adoptions > 0 && <p className="mt-2 text-xs text-muted-foreground">Adopted {data.adoptions} time{data.adoptions === 1 ? "" : "s"}.</p>}
          </div>

          <div className="paper p-5 text-sm">
            <h2 className="eyebrow">Machine door</h2>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{data.hireUrl}</p>
            <Button variant="link" className="mt-1 h-auto p-0 text-sm" onClick={() => toast("MCP", { description: "Tools: surrender · list_residents · get_resident · hire — see “For agents”." })}>
              Also reachable over MCP →
            </Button>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="paper px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="display mt-0.5 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
