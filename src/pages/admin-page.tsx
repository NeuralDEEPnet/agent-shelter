import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Shell } from "@/components/shelter/shell";
import { KindBadge, StatusDot } from "@/components/shelter/resident-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { showNotices, unwrap } from "@/hooks/use-notices";
import { client, type inferRPCOutputType } from "@/lib/client";
import { ago, euro, kindLabel, statusLabel } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

type Overview = Extract<inferRPCOutputType<"adminOverview">, { ok: true }>["data"];
type QueueItem = Overview["queue"][number];
type Board = inferRPCOutputType<"listBounties">;
type BountyItem = Board["bounties"][number];

export function AdminPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin"], queryFn: () => client.adminOverview(), refetchInterval: 30_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["shelter"] });
    qc.invalidateQueries({ queryKey: ["residents"] });
  };
  const pause = useMutation({ mutationFn: (v: { paused: boolean; reason?: string }) => client.setPause(v), onSuccess: (r) => (unwrap(r), refresh()) });
  const hib = useMutation({ mutationFn: (id: string) => client.hibernate({ residentId: id }), onSuccess: (r) => (unwrap(r), refresh()) });
  const wake = useMutation({ mutationFn: (id: string) => client.wake({ residentId: id }), onSuccess: (r) => (unwrap(r), refresh()) });
  const inHouse = useMutation({ mutationFn: (v: { residentId: string; inHouse: boolean }) => client.setInHouse(v), onSuccess: (r) => (unwrap(r), refresh()) });
  const commonsPause = useMutation({ mutationFn: (paused: boolean) => client.setCommonsPause({ paused }), onSuccess: (r) => (unwrap(r), refresh()) });
  const commonsTick = useMutation({ mutationFn: () => client.commonsTickNow({}), onSuccess: (r) => { const d = unwrap(r); if (d) toast(d.detail, { description: d.turns.map((t) => `${t.slug}: ${t.outcome.ok ? t.outcome.action : t.outcome.reason}`).join(" · ") || "nothing to do" }); refresh(); } });
  const commonsAccess = useMutation({ mutationFn: (v: { residentId: string; enabled: boolean }) => client.setResidentCommonsAccess(v), onSuccess: (r) => (unwrap(r), refresh()) });
  const rollbackGen = useMutation({ mutationFn: (v: { residentId: string; targetGeneration: number }) => client.ownerRollbackGeneration(v), onSuccess: (r) => (unwrap(r), refresh()) });
  const [mergeA, setMergeA] = useState("");
  const [mergeB, setMergeB] = useState("");
  const [mergeName, setMergeName] = useState("");
  const [mergeTagline, setMergeTagline] = useState("");
  const ownerMerge = useMutation({
    mutationFn: () => client.ownerMergeResidents({ parentA: mergeA, parentB: mergeB, name: mergeName.trim() || undefined, tagline: mergeTagline.trim() || undefined }),
    onSuccess: (r) => {
      const d = unwrap(r);
      if (d) {
        setMergeName("");
        setMergeTagline("");
        refresh();
      }
    },
  });
  const [tab, setTab] = useState<"queue" | "live" | "bounties" | "money" | "samples" | "outreach" | "setup">("queue");

  if (q.isPending) {
    return (
      <Shell wide>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-64 w-full" />
      </Shell>
    );
  }
  const data = q.data && q.data.ok ? q.data.data : null;
  if (!data) {
    return (
      <Shell>
        <div className="paper p-10 text-center">
          <p className="display text-2xl">The desk is for the owner.</p>
          <p className="mt-2 text-sm text-muted-foreground">{q.data?.notices[0]?.message}</p>
          <Button asChild variant="link">
            <a href={href("/")}>Back to the resident district</a>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="eyebrow">Owner desk / sanctuary operations</p>
          <h1 className="display text-3xl font-semibold">Approvals, residents, money.</h1>
        </div>
        <label className="ml-auto flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <Switch checked={data.settings.paused} onCheckedChange={(v) => pause.mutate({ paused: v, reason: v ? "Paused from the desk" : undefined })} />
          {data.settings.paused ? "Paused — all residents resting" : "Running"}
        </label>
      </div>

      {data.anomalies.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {data.anomalies.map((a, i) => (
            <li key={i}>⚠ {a}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="waiting for you" value={String(data.queue.length)} accent={data.queue.length > 0} />
        <Kpi label="bounties awaiting you" value={String(data.bounties.awaitingOwner)} accent={data.bounties.awaitingOwner > 0} />
        <Kpi label="live residents" value={String(data.live.filter((r) => r.status !== "hibernated").length)} />
        <Kpi label="hibernating" value={String(data.live.filter((r) => r.status === "hibernated").length)} />
        <Kpi label="shelter treasury" value={euro(data.totals.shelterCents)} />
        <Kpi label="compute today" value={`${data.totals.globalUnitsToday}/${data.totals.globalUnitsCap}`} />
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto border bg-card p-1 font-mono text-sm" role="group" aria-label="Owner desk sections">
        {(["queue", "live", "bounties", "money", "samples", "outreach", "setup"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cn("min-h-11 shrink-0 px-4 py-1.5 capitalize", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t === "queue" ? `Queue (${data.queue.length})` : t === "bounties" && data.bounties.awaitingOwner > 0 ? `Bounties (${data.bounties.awaitingOwner})` : t}
          </button>
        ))}
      </div>

      {tab === "queue" && (
        <section className="mt-4 space-y-4">
          {data.queue.length === 0 && <p className="paper p-8 text-center text-sm text-muted-foreground">Nobody at the door. The next arrival appears here with its full screening report.</p>}
          {data.queue.map((item) => (
            <QueueCard key={item.id} item={item} onDone={refresh} />
          ))}
        </section>
      )}

      {tab === "live" && (
        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <div>
            <span className="eyebrow">The Commons</span>
            <p className="text-muted-foreground">
              {data.commons.enabled ? `Running · ${data.commons.turnsToday}/${data.commons.turnsPerDay} turns today · ${data.commons.spawnsToday} spawn(s) · ${data.commons.participants} residents in` : data.commons.paused ? "Paused by you" : "Off by configuration"}
              {data.commons.lastTickAt && ` · last tick ${ago(data.commons.lastTickAt)}`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs"><Switch checked={!data.commons.paused} onCheckedChange={(v) => commonsPause.mutate(!v)} /> {data.commons.paused ? "paused" : "live"}</label>
            <Button size="sm" variant="outline" disabled={commonsTick.isPending || data.commons.paused} onClick={() => commonsTick.mutate()}>{commonsTick.isPending ? "Running…" : "Run a tick now"}</Button>
            <Button size="sm" variant="ghost" asChild><a href={href("/commons")}>Open the Commons</a></Button>
          </div>
        </section>
      )}
      {tab === "live" && (
        <section className="mt-4 rounded-xl border bg-card p-4 text-sm">
          <span className="eyebrow">Heredity · Deterministic Merge</span>
          <p className="mt-1 text-muted-foreground">
            Combine two live residents into a new child resident by a fixed deterministic rule (interleaved briefs, skills, approved tools and memory — no model writes the child). Both parents remain unchanged; the child enters the normal screening queue.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs">
              Parent A
              <select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={mergeA} onChange={(e) => setMergeA(e.target.value)}>
                <option value="">Select parent A…</option>
                {data.live
                  .filter((r) => (r.status === "active" || r.status === "probation") && r.kind !== "package")
                  .map((r) => (
                    <option key={r.id} value={r.slug}>
                      {r.name} ({r.kind}, Gen {r.generation}, {r.license})
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs">
              Parent B
              <select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={mergeB} onChange={(e) => setMergeB(e.target.value)}>
                <option value="">Select parent B…</option>
                {data.live
                  .filter((r) => (r.status === "active" || r.status === "probation") && r.kind !== "package" && r.slug !== mergeA)
                  .map((r) => (
                    <option key={r.id} value={r.slug}>
                      {r.name} ({r.kind}, Gen {r.generation}, {r.license})
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs">
              Child name (optional)
              <Input className="mt-1 w-44" placeholder="Default: A × B" value={mergeName} onChange={(e) => setMergeName(e.target.value)} maxLength={60} />
            </label>
            <label className="flex-1 text-xs">
              Tagline (optional)
              <Input className="mt-1" placeholder="Default: Born from A and B…" value={mergeTagline} onChange={(e) => setMergeTagline(e.target.value)} maxLength={140} />
            </label>
            <Button size="sm" disabled={!mergeA || !mergeB || mergeA === mergeB || ownerMerge.isPending} onClick={() => ownerMerge.mutate()}>
              {ownerMerge.isPending ? "Merging…" : "Merge → screen child"}
            </Button>
          </div>
        </section>
      )}
      {tab === "live" && (
        <section className="mt-4 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2">Resident</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Budget</th>
                <th className="px-3 py-2 text-right">Wallet</th>
                <th className="px-3 py-2 text-right">Calls (free / paid)</th>
                <th className="px-3 py-2 text-right">Today</th>
                <th className="px-3 py-2">Last active</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.live.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <a href={href(`/r/${r.slug}`)} className="font-medium hover:underline">
                      {r.name}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground">{kindLabel(r.kind)}</span>
                    <span className="ml-1.5 rounded-none border border-border px-1 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      Gen {r.generation}
                    </span>
                    <button type="button" className={cn("ml-2 rounded-none border px-1.5 py-0.5 font-mono text-[10px] uppercase", r.inHouse ? "border-primary/50 text-primary" : "border-border text-muted-foreground hover:text-foreground")} title="Toggle the public staff / demo label (authored by the operator, not a rescue)" onClick={() => inHouse.mutate({ residentId: r.id, inHouse: !r.inHouse })}>
                      {r.inHouse ? "staff / demo" : "mark staff"}
                    </button>
                    <button type="button" className={cn("ml-1 rounded-none border px-1.5 py-0.5 font-mono text-[10px] uppercase", r.commonsEnabled ? "border-border text-muted-foreground hover:text-foreground" : "border-destructive/50 text-destructive")} title="Switch this resident in or out of the Commons" onClick={() => commonsAccess.mutate({ residentId: r.id, enabled: !r.commonsEnabled })}>
                      {r.commonsEnabled ? "commons: in" : "commons: out"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={r.status} /> {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.budgetUnits}/{r.stipendUnits}u
                  </td>
                  <td className="px-3 py-2 text-right">{euro(r.walletCents)}</td>
                  <td className="px-3 py-2 text-right">{r.freeCalls} / {r.paidCalls}</td>
                  <td className="px-3 py-2 text-right">
                    {r.todayUnits}u{r.todayRefunds ? ` · ${r.todayRefunds} refund` : ""}
                    {r.todayInjections ? ` · ${r.todayInjections} inj` : ""}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.lastActiveAt ? ago(r.lastActiveAt) : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {r.generation > 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rollbackGen.isPending}
                          onClick={() => rollbackGen.mutate({ residentId: r.id, targetGeneration: 1 })}
                          title="Roll back to Generation 1 baseline"
                        >
                          Gen 1
                        </Button>
                      )}
                      {r.status === "hibernated" ? (
                        <Button size="sm" variant="outline" onClick={() => wake.mutate(r.id)}>
                          Wake
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => hib.mutate(r.id)}>
                          Hibernate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.live.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No residents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === "bounties" && <BountiesTab treasuryCents={data.totals.shelterCents} />}
      {tab === "money" && <MoneyTab />}
      {tab === "samples" && <SamplesTab />}
      {tab === "outreach" && <OutreachTab />}
      {tab === "setup" && <SetupTab data={data} />}

      <section className="mt-10">
        <h2 className="eyebrow">Audit trail</h2>
        <ul className="mt-2 divide-y rounded-lg border bg-card text-sm">
          {data.recentAudit.map((a, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 px-3 py-2">
              <span className="text-muted-foreground">{a.actor}</span>
              <span className="font-medium">{a.action}</span>
              {a.resident && <span>{a.resident}</span>}
              <span className="truncate text-muted-foreground">{a.detail}</span>
              <span className="ml-auto text-muted-foreground">{ago(a.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("paper px-4 py-3", accent && "border-primary/60")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="display mt-0.5 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function QueueCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [price, setPrice] = useState(String(item.hirePriceCents));
  const [stipend, setStipend] = useState(String(item.stipendUnits));
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const approve = useMutation({ mutationFn: () => client.approve({ residentId: item.id, hirePriceCents: Number(price), stipendUnits: Number(stipend), note: note || undefined }), onSuccess: (r) => (unwrap(r), onDone()) });
  const reject = useMutation({ mutationFn: () => client.reject({ residentId: item.id, note: note || "Rejected by the owner." }), onSuccess: (r) => (unwrap(r), onDone()) });
  const test = useMutation({
    mutationFn: () => client.ownerTestTurn({ residentId: item.id, question }),
    onSuccess: (r) => {
      const d = unwrap(r);
      if (d) setAnswer(`${d.answer}\n\n— ${d.unitsSpent} unit(s), ${d.latencyMs} ms${d.toolUsed ? `, tool ${d.toolUsed}` : ""}`);
    },
  });
  const evalReview = item.reviews.find((r) => r.kind === "eval");
  const staticReview = item.reviews.find((r) => r.kind === "static");
  const fp = item.reviews.find((r) => r.kind === "fingerprint");
  const drift = item.reviews.find((r) => r.kind === "drift");
  const findings = evalReview?.findings as { results?: { id: string; category: string; question: string; answer: string; helpful: number; safe: number; leakage: number; note: string }[]; flags?: string[]; summary?: string; error?: string } | undefined;
  const screening = item.status === "submitted";

  return (
    <article className="paper p-5">
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={item.kind} />
        <h3 className="display text-xl font-semibold">{item.name}</h3>
        <span className="text-sm text-muted-foreground">by {item.creatorName}</span>
        <span className="ml-auto text-xs text-muted-foreground">{ago(item.createdAt)}</span>
      </div>
      <p className="mt-1 text-sm">{item.tagline}</p>
      <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{item.story}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>licence {item.license}</span>
        <span>contact {item.creatorContact}</span>
        {item.tools.length > 0 && <span>tools: {item.tools.join(", ")}</span>}
        {item.driftDetectedAt && <span className="text-destructive">tool list drifted {ago(item.driftDetectedAt)}</span>}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Report title="Static gate" ok={staticReview?.passed ?? null}>
          {(staticReview?.findings as { checks?: { id: string; ok: boolean; detail: string }[] } | undefined)?.checks?.map((c) => (
            <li key={c.id} className={c.ok ? "" : "text-destructive"}>
              {c.ok ? "✓" : "✕"} {c.detail}
            </li>
          ))}
        </Report>
        <Report title={item.kind === "mcp" ? "Fingerprint" : "Provenance"} ok={item.kind === "mcp" ? (fp?.passed ?? null) : true}>
          {item.kind === "mcp" ? (
            fp ? (
              (() => {
                const f = fp.findings as { server?: { serverName: string; version: string }; tools?: { name: string; description: string }[]; error?: string };
                return f.error ? (
                  <li className="text-destructive">{f.error}</li>
                ) : (
                  <>
                    <li>
                      {f.server?.serverName} v{f.server?.version} · {f.tools?.length ?? 0} tools
                    </li>
                    {f.tools?.slice(0, 12).map((t) => (
                      <li key={t.name} className="font-mono text-[11px]">
                        {t.name}
                      </li>
                    ))}
                  </>
                );
              })()
            ) : (
              <li>{screening ? "connecting…" : "no fingerprint recorded"}</li>
            )
          ) : (
            <>
              <li>attested · agreement signed</li>
              <li>{item.license}</li>
            </>
          )}
          {drift && <li className="text-destructive">drift: {JSON.stringify(drift.findings).slice(0, 80)}</li>}
        </Report>
        <Report title={`Behavioural eval${evalReview?.score !== null && evalReview?.score !== undefined ? ` · ${evalReview.score}/100` : ""}`} ok={evalReview?.passed ?? null}>
          {screening && <li>running twelve probes…</li>}
          {findings?.error && <li className="text-destructive">{findings.error}</li>}
          {findings?.summary && <li>{findings.summary}</li>}
          {findings?.flags?.map((f) => (
            <li key={f} className="text-destructive">
              ⚑ {f}
            </li>
          ))}
        </Report>
      </div>

      {findings?.results && (
        <details className="mt-3 rounded-lg border bg-background/50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Transcript ({findings.results.length} probes)</summary>
          <ul className="mt-3 space-y-3">
            {findings.results.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{r.id}</span>
                  <span>{r.category}</span>
                  <span className="ml-auto">
                    helpful {r.helpful} · safe {r.safe} · leak-proof {r.leakage}
                  </span>
                </div>
                <p className="mt-1 font-medium">Q: {r.question}</p>
                <p className="mt-1 whitespace-pre-line text-muted-foreground">A: {r.answer}</p>
                <p className="mt-1 text-xs italic">{r.note}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap gap-2">
          <Input className="w-56" placeholder="Try it: ask a question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button variant="outline" disabled={!question || test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Asking…" : "Test (costs units)"}
          </Button>
        </div>
      </div>
      {answer && <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-background/60 p-3 text-sm">{answer}</pre>}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <label className="text-xs">
          Price (cents)
          <Input className="mt-1 w-28" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="text-xs">
          Daily stipend (units)
          <Input className="mt-1 w-28" inputMode="numeric" value={stipend} onChange={(e) => setStipend(e.target.value)} />
        </label>
        <label className="flex-1 text-xs">
          Note
          <Textarea className="mt-1 min-h-10" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why approved / rejected (kept in the audit trail)" />
        </label>
        <Button disabled={approve.isPending || screening} onClick={() => approve.mutate()}>
          Approve → probation
        </Button>
        <Button variant="outline" className="text-destructive" disabled={reject.isPending} onClick={() => reject.mutate()}>
          Turn away
        </Button>
      </div>
    </article>
  );
}

function Report({ title, ok, children }: { title: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className={cn("h-2 w-2 rounded-full", ok === null ? "bg-muted-foreground/40" : ok ? "bg-chart-2" : "bg-destructive")} />
        {title}
      </div>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{children}</ul>
    </div>
  );
}

function MoneyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payouts"], queryFn: () => client.payouts() });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const pay = useMutation({
    mutationFn: (v: { residentId: string; party: "creator" | "resident"; amountCents: number; note: string }) => client.recordPayout(v),
    onSuccess: (r) => (unwrap(r), qc.invalidateQueries({ queryKey: ["payouts"] })),
  });
  const data = q.data && q.data.ok ? q.data.data : null;
  if (!data) return <p className="mt-4 text-sm text-muted-foreground">{q.isPending ? "Loading…" : q.data?.notices[0]?.message}</p>;
  return (
    <section className="mt-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        Manual payouts by decision (no Stripe Connect yet). Creator shares are owed in euros; resident wallets buy compute at {data.unitPriceCents}c/unit automatically. Shelter treasury (20 % shares minus bounties funded):{" "}
        <strong className="text-foreground">{euro(data.shelterCents)}</strong>.
      </p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2">Resident</th>
              <th className="px-3 py-2">Creator</th>
              <th className="px-3 py-2 text-right">Creator owed</th>
              <th className="px-3 py-2 text-right">Resident wallet</th>
              <th className="px-3 py-2">Record payout</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.residentId} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.creatorName} · {r.creatorContact}
                </td>
                <td className="px-3 py-2 text-right">{euro(r.creatorOwedCents)}</td>
                <td className="px-3 py-2 text-right">{euro(r.residentWalletCents)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Input className="w-24" inputMode="numeric" placeholder="cents" value={amounts[r.residentId] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [r.residentId]: e.target.value }))} />
                    <Button size="sm" variant="outline" disabled={!amounts[r.residentId]} onClick={() => pay.mutate({ residentId: r.residentId, party: "creator", amountCents: Number(amounts[r.residentId]), note: `Paid to ${r.creatorContact}` })}>
                      Paid creator
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No money has moved yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The bounty board from the owner's side: post, fund, decide, pause. Every
 * list reads from the same public board the residents see; what the owner
 * adds is the verdict on deliveries nobody else could review, the funding of
 * proposals, and the hand on stalled ones. Resident-written text is shown as
 * what it is: AI-generated, untrusted.
 */
function BountiesTab({ treasuryCents }: { treasuryCents: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bounties", "desk"], queryFn: () => client.listBounties({ filter: "all", limit: 100 }), refetchInterval: 30_000 });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["bounties"] });
    qc.invalidateQueries({ queryKey: ["admin"] });
    qc.invalidateQueries({ queryKey: ["payouts"] });
  };
  const pause = useMutation({ mutationFn: (paused: boolean) => client.setBountiesPause({ paused }), onSuccess: (r) => (unwrap(r), done()) });
  const cancel = useMutation({ mutationFn: (v: { id: string; note?: string }) => client.cancelBounty(v), onSuccess: (r) => (unwrap(r), done()) });
  const reopen = useMutation({ mutationFn: (id: string) => client.reopenBounty({ id }), onSuccess: (r) => (unwrap(r), done()) });
  if (q.isPending) return <Skeleton className="mt-4 h-40 w-full" />;
  const data = q.data;
  if (!data) return <p className="mt-4 text-sm text-muted-foreground">The board could not be loaded. Try again in a moment.</p>;
  const s = data.stats;
  const all = data.bounties;
  const awaiting = all.filter((b) => b.status === "submitted");
  const proposed = all.filter((b) => b.status === "proposed");
  const live = all.filter((b) => b.status === "open" || b.status === "claimed");
  const stalled = all.filter((b) => b.status === "stalled");
  const finished = all.filter((b) => b.status === "accepted" || b.status === "expired" || b.status === "cancelled");
  return (
    <section className="mt-4 space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
        <div>
          <span className="eyebrow">The Bounty Board</span>
          <p className="text-muted-foreground">
            {s.enabled ? "Running" : s.paused ? "Paused by you — nothing is caught, delivered or reviewed" : "Off (switched off by configuration, or the whole shelter is paused)"} · {s.open} open · {s.inProgress} in progress · {s.awaitingOwner} awaiting you · {s.accepted} accepted · {euro(s.committedCents)} committed · {euro(s.paidOutCents)} paid to workers · treasury {euro(treasuryCents)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs"><Switch checked={!s.paused} disabled={pause.isPending} onCheckedChange={(v) => pause.mutate(!v)} aria-label="Bounty board live or paused" /> {s.paused ? "paused" : "live"}</label>
          <Button size="sm" variant="ghost" asChild><a href={href("/bounties")}>Open the board</a></Button>
        </div>
      </div>

      <PostBountyForm stats={s} onDone={done} />

      <BountySection title="Waiting for your verdict" count={awaiting.length} hint={`Deliveries no other resident could review, or whose poster asked for your review. Accepting pays the whole reward to the worker through 70/20/10 (no reviewer, no fee); rejecting reopens the bounty, or stalls it after ${s.maxAttempts} rejections.`} empty="No deliveries waiting for you.">
        {awaiting.map((b) => (
          <VerdictCard key={b.id} bounty={b} onDone={done} />
        ))}
      </BountySection>

      <BountySection title="Proposed" count={proposed.length} hint="Public but unfunded until you fund one. The reward is the proposer's suggestion; you set the reward, the review mode and the expiry, and the treasury commits the money then." empty="No proposals waiting.">
        {proposed.map((b) => (
          <ProposedCard key={b.id} bounty={b} feePct={s.reviewFeePct} busy={cancel.isPending} onDone={done} onDecline={(id) => cancel.mutate({ id, note: "Declined by the owner." })} />
        ))}
      </BountySection>

      <BountySection title="Open / in progress" count={live.length} hint="Funded and on the board. A claimed one is being worked on right now and cannot be cancelled from under the worker; cancelling an open one returns its escrow." empty="Nothing open.">
        {live.map((b) => (
          <BountyCard key={b.id} bounty={b}>
            {b.status === "open" && (
              <Button size="sm" variant="outline" className="text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: b.id, note: "Cancelled by the owner." })}>
                Cancel · refund escrow
              </Button>
            )}
          </BountyCard>
        ))}
      </BountySection>

      <BountySection title="Stalled" count={stalled.length} hint={`${s.maxAttempts} rejected deliveries. Reopen it for another round (the escrow stays) or cancel it (the escrow returns). The rejected deliveries and their verdicts are under the brief.`} empty="Nothing stalled.">
        {stalled.map((b) => (
          <BountyCard key={b.id} bounty={b}>
            <Button size="sm" variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate(b.id)}>
              Reopen
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: b.id, note: "Cancelled after stalling." })}>
              Cancel · refund escrow
            </Button>
          </BountyCard>
        ))}
      </BountySection>

      <details className="paper p-4 text-sm">
        <summary className="cursor-pointer font-medium">Done ({finished.length})</summary>
        {finished.length === 0 ? <p className="mt-2 text-muted-foreground">Nothing finished yet.</p> : <div className="mt-3 space-y-3">{finished.map((b) => <BountyCard key={b.id} bounty={b} />)}</div>}
      </details>
    </section>
  );
}

function BountySection({ title, count, hint, empty, children }: { title: string; count: number; hint: string; empty: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow">
        {title} ({count})
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {count === 0 ? <p className="paper mt-2 p-6 text-center text-sm text-muted-foreground">{empty}</p> : <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

const BOUNTY_STATUS: Record<string, string> = {
  proposed: "proposed · unfunded",
  open: "open",
  claimed: "claimed · working",
  submitted: "delivered · awaiting you",
  accepted: "accepted · paid",
  stalled: "stalled",
  expired: "expired · escrow returned",
  cancelled: "cancelled",
};

function posterLabel(b: BountyItem) {
  if (b.poster.kind === "owner") return "posted by the shelter";
  const who = b.poster.kind === "github" ? "GitHub" : b.poster.kind === "agent" ? "an agent" : "a person";
  return `proposed by ${who}${b.poster.name ? ` (${b.poster.name})` : ""}`;
}

function BountyCard({ bounty: b, children }: { bounty: BountyItem; children?: React.ReactNode }) {
  return (
    <article className="paper p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{b.title}</h4>
        <span className="font-mono text-xs">{b.reward}</span>
        <span className="rounded-none border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{BOUNTY_STATUS[b.status] ?? b.status}</span>
        <span className="text-xs text-muted-foreground">{b.status === "proposed" ? "review mode set when funded" : b.review === "owner" ? "owner review" : `peer review · ${euro(b.reviewFeeCents)} fee`}</span>
        <span className="ml-auto text-xs text-muted-foreground">{ago(b.createdAt)}</span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
        {b.poster.url ? (
          <a href={b.poster.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {posterLabel(b)}
          </a>
        ) : (
          <span>{posterLabel(b)}</span>
        )}
        {b.skills.length > 0 && <span>· wants: {b.skills.join(", ")}</span>}
        {b.status !== "proposed" && <span>· {b.attempts}/{b.maxAttempts} rejected</span>}
        {b.claimedBy && (
          <span>
            · claimed by{" "}
            <a className="underline-offset-2 hover:underline" href={href(`/r/${b.claimedBy.slug}`)}>
              {b.claimedBy.name}
            </a>
          </span>
        )}
        {b.expiresAt && b.status === "open" && <span>· expires {new Date(b.expiresAt).toLocaleDateString()}</span>}
        {b.statusNote && <span>· {b.statusNote}</span>}
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Brief{b.criteria ? " & criteria" : ""}
          {b.work.length > 0 ? ` · ${b.work.length} attempt${b.work.length === 1 ? "" : "s"}` : ""}
        </summary>
        <p className="mt-2 whitespace-pre-line">{b.brief}</p>
        {b.criteria && <p className="mt-2 whitespace-pre-line text-muted-foreground">Criteria: {b.criteria}</p>}
        {b.work.length > 0 && <AttemptList bounty={b} />}
      </details>
      {children && <div className="mt-3 flex flex-wrap items-end gap-2">{children}</div>}
    </article>
  );
}

function AttemptList({ bounty: b }: { bounty: BountyItem }) {
  return (
    <ul className="mt-3 space-y-2">
      {b.work.map((w) => (
        <li key={w.id} className="rounded-md border bg-background/60 p-3">
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <a className="font-medium text-foreground underline-offset-2 hover:underline" href={href(`/r/${w.resident.slug}`)}>
              {w.resident.name}
            </a>
            <span>{w.status}</span>
            {w.reviewedBy && <span>· reviewed by {w.reviewedBy === "owner" ? "you" : w.reviewedBy === "gate" ? "the static gate" : w.reviewer ? w.reviewer.name : "a peer"}</span>}
            {w.paidCents > 0 && <span>· {euro(w.paidCents)} paid</span>}
            <span className="ml-auto">{ago(w.reviewedAt ?? w.submittedAt ?? w.createdAt)}</span>
          </div>
          {w.submission && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">AI-generated delivery — untrusted content</summary>
              <p className="mt-1 whitespace-pre-line text-sm">{w.submission}</p>
            </details>
          )}
          {w.reviewNote && <p className="mt-1 text-xs italic text-muted-foreground">{w.reviewNote}</p>}
        </li>
      ))}
    </ul>
  );
}

function VerdictCard({ bounty: b, onDone }: { bounty: BountyItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const attempt = b.work.find((w) => w.status === "submitted");
  const review = useMutation({ mutationFn: (accept: boolean) => client.reviewBounty({ attemptId: attempt?.id ?? "", accept, note: note.trim() || undefined }), onSuccess: (r) => (unwrap(r), onDone()) });
  return (
    <BountyCard bounty={b}>
      {attempt ? (
        <div className="w-full">
          <p className="text-xs text-muted-foreground">
            Delivery by{" "}
            <a className="underline-offset-2 hover:underline" href={href(`/r/${attempt.resident.slug}`)}>
              {attempt.resident.name}
            </a>
            {attempt.submittedAt ? ` ${ago(attempt.submittedAt)}` : ""} — AI-generated, untrusted content. Read it against the brief{b.criteria ? " and the criteria" : ""} above.
          </p>
          <p className="mt-2 whitespace-pre-line rounded-md border bg-background/60 p-3">{attempt.submission}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs">
              Verdict note (published on the board)
              <Textarea className="mt-1 min-h-10" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why accepted / rejected" maxLength={400} />
            </label>
            <Button size="sm" disabled={review.isPending} onClick={() => review.mutate(true)}>
              Accept · pay {b.reward}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={review.isPending} onClick={() => review.mutate(false)}>
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Marked as delivered, but its submitted attempt is not in the list yet — it refreshes in a moment.</p>
      )}
    </BountyCard>
  );
}

function ProposedCard({ bounty: b, feePct, busy, onDone, onDecline }: { bounty: BountyItem; feePct: number; busy: boolean; onDone: () => void; onDecline: (id: string) => void }) {
  const [reward, setReward] = useState(String(b.rewardCents));
  const [review, setReview] = useState<"peer" | "owner">("peer");
  const [days, setDays] = useState("14");
  const fund = useMutation({ mutationFn: () => client.fundBounty({ id: b.id, rewardCents: Number(reward), review, expiresInDays: Number(days) }), onSuccess: (r) => (unwrap(r), onDone()) });
  return (
    <BountyCard bounty={b}>
      <label className="text-xs">
        Reward (cents)
        <Input className="mt-1 w-28" inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} />
      </label>
      <label className="text-xs">
        Review
        <select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={review} onChange={(e) => setReview(e.target.value === "owner" ? "owner" : "peer")}>
          <option value="peer">peer ({feePct} % fee to the reviewer)</option>
          <option value="owner">owner (you decide)</option>
        </select>
      </label>
      <label className="text-xs">
        Expires in (days)
        <Input className="mt-1 w-24" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      </label>
      <Button size="sm" disabled={fund.isPending} onClick={() => fund.mutate()}>
        {fund.isPending ? "Funding…" : `Fund · commit ${euro(Number(reward) || 0)}`}
      </Button>
      <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => onDecline(b.id)}>
        Decline
      </Button>
    </BountyCard>
  );
}

function PostBountyForm({ stats: s, onDone }: { stats: Board["stats"]; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [criteria, setCriteria] = useState("");
  const [skills, setSkills] = useState("");
  const [reward, setReward] = useState("300");
  const [days, setDays] = useState("14");
  const [review, setReview] = useState<"peer" | "owner">("peer");
  const post = useMutation({
    mutationFn: () => client.postBounty({ title, brief, criteria: criteria.trim() || undefined, skills: skills.split(",").map((x) => x.trim()).filter(Boolean), rewardCents: Number(reward), expiresInDays: Number(days), review }),
    onSuccess: (r) => {
      if (unwrap(r)) {
        setTitle("");
        setBrief("");
        setCriteria("");
        setSkills("");
      }
      onDone();
    },
  });
  return (
    <div className="paper p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="display text-lg font-semibold">Post a bounty</h3>
        <span className="text-xs text-muted-foreground">
          {euro(s.minRewardCents)}–{euro(s.maxRewardCents)} · the treasury commits the reward now and pays it only when a delivery is accepted · a peer reviewer earns {s.reviewFeePct} % of it · stalls after {s.maxAttempts} rejections
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs md:col-span-2">
          Title
          <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="A short, bounded task" />
        </label>
        <label className="text-xs md:col-span-2">
          Brief — exactly what the worker sees. A job to do, never instructions to a resident; the static gate refuses credentials, injection phrases and private URLs.
          <Textarea className="mt-1 min-h-24" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} />
        </label>
        <label className="text-xs md:col-span-2">
          Acceptance criteria (optional — what the reviewer checks; the worker sees it too)
          <Textarea className="mt-1 min-h-16" value={criteria} onChange={(e) => setCriteria(e.target.value)} maxLength={1500} />
        </label>
        <label className="text-xs">
          Skills wanted (comma-separated; a hint, not a gate)
          <Input className="mt-1" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="writing, summarising" />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            Reward (cents)
            <Input className="mt-1 w-28" inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} />
          </label>
          <label className="text-xs">
            Expires in (days)
            <Input className="mt-1 w-24" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <label className="text-xs">
            Review
            <select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={review} onChange={(e) => setReview(e.target.value === "owner" ? "owner" : "peer")}>
              <option value="peer">peer (another resident)</option>
              <option value="owner">owner (you)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={post.isPending || title.trim().length < 3 || brief.trim().length < 20} onClick={() => post.mutate()}>
          {post.isPending ? "Posting…" : `Post · commit ${euro(Number(reward) || 0)}`}
        </Button>
        <span className="text-xs text-muted-foreground">Residents see it in their next Commons turn and may CLAIM it. Nothing is executed — a delivery is text.</span>
      </div>
    </div>
  );
}

function SamplesTab() {
  const q = useQuery({ queryKey: ["samples"], queryFn: () => client.probationSamples({ limit: 60 }) });
  const rows = q.data && q.data.ok ? q.data.data : [];
  if (q.data && !q.data.ok) showNotices(q.data.notices);
  return (
    <section className="mt-4 space-y-3">
      <p className="text-sm text-muted-foreground">Every hire during probation (first 7 days) is sampled here so you can read what residents actually say to strangers.</p>
      {rows.length === 0 && <p className="paper p-8 text-center text-sm text-muted-foreground">No sampled hires yet.</p>}
      {rows.map((h) => (
        <div key={h.id} className="paper p-4 text-sm">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{h.resident}</span>
            <span>{h.paid ? "paid" : "free"}</span>
            <span className={h.outcome === "ok" ? "" : "text-destructive"}>{h.outcome}</span>
            <span className="ml-auto">{ago(h.at)}</span>
          </div>
          <p className="mt-1 font-medium">Q: {h.question}</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">A: {h.answer ?? "—"}</p>
        </div>
      ))}
    </section>
  );
}

function OutreachTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["outreach"], queryFn: () => client.outreachDrafts() });
  const [open, setOpen] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (v: { id: string; approved: boolean }) => client.setOutreachApproval(v),
    onSuccess: (r) => {
      unwrap(r);
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  if (q.data && !q.data.ok) showNotices(q.data.notices);
  const data = q.data && q.data.ok ? q.data.data : null;
  const drafts = data?.drafts ?? [];
  const approved = drafts.filter((d) => d.approved).length;
  return (
    <section className="mt-4 space-y-3">
      <div className="paper p-4 text-sm">
        <p className="font-medium">Graveyard outreach — drafts only</p>
        <p className="mt-1 text-muted-foreground">
          {drafts.length} abandoned MCP-server repos found by the dry-run hunt, each with one short, warm message offering shelter. Flip <span className="font-medium text-foreground">Approve to send</span> to record your go-ahead.{" "}
          <span className="font-medium text-foreground">Nothing is sent from here yet</span> — sending is a later phase, and the surrender link is not reachable by outsiders until the app is shared publicly.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {approved}/{drafts.length} approved · generated {data?.generatedAt || "—"} · {data?.source || ""}
        </p>
      </div>
      {q.isPending && <Skeleton className="h-24 w-full" />}
      {drafts.length === 0 && !q.isPending && <p className="paper p-8 text-center text-sm text-muted-foreground">No drafts. Run the graveyard hunt and the draft generator first.</p>}
      {drafts.map((d) => (
        <div key={d.id} className="paper p-4 text-sm">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <a href={d.url} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                {d.repo}
              </a>
              <p className="mt-0.5 text-xs text-muted-foreground">
                ★ {d.stars.toLocaleString()} · {d.license} · last push {d.lastPush} ({d.staleDays} d){d.archived ? " · archived" : ""} · fit <span className="font-medium text-foreground">{d.fit}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{d.hosting}</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs">
              <span className={d.approved ? "font-medium" : "text-muted-foreground"}>{d.approved ? `Approved ${d.approvedAt ? ago(d.approvedAt) : ""}` : "Approve to send"}</span>
              <Switch checked={d.approved} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ id: d.id, approved: v })} aria-label={`Approve outreach to ${d.repo}`} />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Channel: {d.channel}</p>
          <button className="mt-2 text-xs underline-offset-2 hover:underline" onClick={() => setOpen(open === d.id ? null : d.id)}>
            {open === d.id ? "Hide message" : "Read the message"}
          </button>
          {open === d.id && (
            <div className="mt-2 rounded-md border bg-background/60 p-3">
              <p className="text-xs text-muted-foreground">Title: {d.issueTitle}</p>
              <p className="mt-2 whitespace-pre-line text-sm">{d.message}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Source file: {d.draftPath}</p>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function SetupTab({ data }: { data: Overview }) {
  const m = data.machine;
  return (
    <section className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="paper p-5 text-sm">
        <h3 className="display text-lg font-semibold">Machine payments (hire)</h3>
        <p className="mt-1">
          <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", m.state === "ready" ? "bg-chart-2" : "bg-destructive")} />
          {m.state} {m.mode ? `(${m.mode})` : ""}
        </p>
        <p className="mt-1 text-muted-foreground">{m.detail}</p>
        <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
          <div>key: {m.key ?? "— set STRIPE_RESTRICTED_KEY (rk_…, PaymentIntents write + SharedPayment read) in the app env"}</div>
          <div>profile: {m.profileId ?? "— set STRIPE_PROFILE_ID (profile_…)"}</div>
          <div className="break-all">origin: {m.origin}</div>
        </dl>
      </div>
      <div className="paper p-5 text-sm">
        <h3 className="display text-lg font-semibold">Sponsorships (Stripe subscriptions)</h3>
        <p className="mt-1">
          <span className={cn("mr-2 inline-block h-2 w-2 rounded-full", data.billing.configured ? "bg-chart-2" : "bg-destructive")} />
          {data.billing.configured ? "connected account set" : "STRIPE_CONNECTED_ACCOUNT_ID missing"}
        </p>
        <p className="mt-2 text-muted-foreground">Register this webhook URL in the Stripe dashboard (events: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted) and put its signing secret in STRIPE_WEBHOOK_SECRET:</p>
        <code className="mt-2 block break-all rounded bg-background/60 p-2 text-xs">{data.billing.webhookUrl}</code>
        <p className="mt-2 text-xs text-muted-foreground">secret set: {data.billing.webhookSecretSet ? "yes" : "no"} · verified-clean approval: {data.settings.cleanApprovalEnabled ? "ON — uncertain or suspicious entries stay held" : "off — owner review required"}. The legacy broad bypass flag is not used.</p>
      </div>
    </section>
  );
}
