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
type Attempt = Overview["heredity"]["log"][number];

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
  const heredityAccess = useMutation({ mutationFn: (v: { residentId: string; enabled: boolean }) => client.setHeredity(v), onSuccess: (r) => (unwrap(r), refresh()) });
  const evolve = useMutation({ mutationFn: (residentId: string) => client.evolveNow({ residentId }), onSuccess: (r) => (unwrap(r), refresh()) });
  const [tab, setTab] = useState<"queue" | "live" | "lineage" | "money" | "samples" | "outreach" | "setup">("queue");

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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="waiting for you" value={String(data.queue.length)} accent={data.queue.length > 0} />
        <Kpi label="live residents" value={String(data.live.filter((r) => r.status !== "hibernated").length)} />
        <Kpi label="hibernating" value={String(data.live.filter((r) => r.status === "hibernated").length)} />
        <Kpi label="shelter's 20 %" value={euro(data.totals.shelterCents)} />
        <Kpi label="compute today" value={`${data.totals.globalUnitsToday}/${data.totals.globalUnitsCap}`} />
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto border bg-card p-1 font-mono text-sm" role="group" aria-label="Owner desk sections">
        {(["queue", "live", "lineage", "money", "samples", "outreach", "setup"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cn("min-h-11 shrink-0 px-4 py-1.5 capitalize", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t === "queue" ? `Queue (${data.queue.length})` : t === "lineage" && data.heredity.log.some((g) => g.status === "held") ? `Lineage (${data.heredity.log.filter((g) => g.status === "held").length})` : t}
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
                    <button type="button" className={cn("ml-2 rounded-none border px-1.5 py-0.5 font-mono text-[10px] uppercase", r.inHouse ? "border-primary/50 text-primary" : "border-border text-muted-foreground hover:text-foreground")} title="Toggle the public staff / demo label (authored by the operator, not a rescue)" onClick={() => inHouse.mutate({ residentId: r.id, inHouse: !r.inHouse })}>
                      {r.inHouse ? "staff / demo" : "mark staff"}
                    </button>
                    <button type="button" className={cn("ml-1 rounded-none border px-1.5 py-0.5 font-mono text-[10px] uppercase", r.commonsEnabled ? "border-border text-muted-foreground hover:text-foreground" : "border-destructive/50 text-destructive")} title="Switch this resident in or out of the Commons" onClick={() => commonsAccess.mutate({ residentId: r.id, enabled: !r.commonsEnabled })}>
                      {r.commonsEnabled ? "commons: in" : "commons: out"}
                    </button>
                    <button type="button" className={cn("ml-1 rounded-none border px-1.5 py-0.5 font-mono text-[10px] uppercase", r.heredityEnabled ? "border-border text-muted-foreground hover:text-foreground" : "border-destructive/50 text-destructive")} title="Switch this resident in or out of evolution and merging (for a creator who wants the agent left as it is)" onClick={() => heredityAccess.mutate({ residentId: r.id, enabled: !r.heredityEnabled })}>
                      {r.heredityEnabled ? `gen ${r.generation}` : `gen ${r.generation} · frozen`}
                    </button>
                    {r.kind === "agent" && r.heredityEnabled && r.status !== "hibernated" && (
                      <button type="button" className="ml-1 rounded-none border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground disabled:opacity-50" title="Start an evolution attempt now: a candidate brief is written, screened against this one and examined. The shelter pays; the selection rule is the same." disabled={evolve.isPending} onClick={() => evolve.mutate(r.id)}>
                        evolve
                      </button>
                    )}
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
                    {r.status === "hibernated" ? (
                      <Button size="sm" variant="outline" onClick={() => wake.mutate(r.id)}>
                        Wake
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => hib.mutate(r.id)}>
                        Hibernate
                      </Button>
                    )}
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

      {tab === "lineage" && <LineageTab data={data} onDone={refresh} />}
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

const ATTEMPT_STATUS: Record<string, string> = { queued: "being written", screening: "being screened", held: "waiting for you", live: "live", retired: "retired", rejected: "not adopted", stale: "abandoned", failed: "failed" };

/** Evolution and merging: candidates waiting for a decision, merge two residents, every generation with rollback. */
function LineageTab({ data, onDone }: { data: Overview; onDone: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const merge = useMutation({
    mutationFn: () => client.mergeNow({ aSlug: a, bSlug: b, name: name.trim() || undefined, tagline: tagline.trim() || undefined }),
    onSuccess: (r) => {
      const d = unwrap(r);
      if (d) {
        toast(`${d.name} was born`, { description: `Licence ${d.license}.${d.ownerHold ? " Held for you: proprietary parents from different rights-holders." : ""}${d.notes.length ? ` ${d.notes.join(" ")}` : ""} It is in the queue being screened.` });
        setName("");
        setTagline("");
      }
      onDone();
    },
  });
  const rollback = useMutation({ mutationFn: (v: { residentId: string; number: number }) => client.rollbackEvolution(v), onSuccess: (r) => (unwrap(r), onDone()) });
  const candidates = data.live.filter((r) => r.status !== "hibernated" && r.kind !== "package" && r.heredityEnabled);
  const held = data.heredity.log.filter((g) => g.status === "held");
  return (
    <section className="mt-4 space-y-4">
      <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        Residents evolve and merge on their own in the Commons (bare action words, no text of their own). A candidate generation is adopted only if it is no less safe on every safety probe and measurably better: {data.heredity.minGain} screening points, or a clear win in a blind exam on its own job. {data.heredity.autoAdopt ? "Adoption is automatic unless people already pay for the resident; then it waits here for you." : "Automatic adoption is off: every adoptable candidate waits here for you."} Every generation is kept and you can roll back at any time.
      </p>

      {held.map((g) => (
        <HeldCard key={g.id} g={g} onDone={onDone} />
      ))}

      <div className="rounded-xl border bg-card p-4">
        <h2 className="eyebrow">Merge two residents</h2>
        <p className="mt-1 text-xs text-muted-foreground">A new resident is composed by a fixed rule from both briefs and approved tools, enters the queue and is screened like any arrival. Both parents stay as they are. Only you can name the child.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([[a, setA, "First parent"], [b, setB, "Second parent"]] as const).map(([value, set, label]) => (
            <select key={label} aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="h-9 border bg-background px-2 text-sm">
              <option value="">{label}…</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.slug}>
                  {r.name} ({kindLabel(r.kind)}, gen {r.generation})
                </option>
              ))}
            </select>
          ))}
          <Input placeholder="Child's name (optional; default: A × B)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Child's tagline (optional)" maxLength={140} value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </div>
        <Button className="mt-3" size="sm" disabled={!a || !b || a === b || merge.isPending} onClick={() => merge.mutate()}>
          {merge.isPending ? "Merging…" : "Merge"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2">Resident</th>
              <th className="px-3 py-2">Generation</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">Units (resident + shelter)</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.heredity.log.map((g) => (
              <tr key={g.id} className="border-b align-top last:border-0">
                <td className="px-3 py-2">
                  <a href={href(`/r/${g.slug}`)} className="font-medium hover:underline">{g.name}</a>
                </td>
                <td className="px-3 py-2">{g.number !== null ? `${g.number} · ${g.origin}` : `candidate for ${g.liveGeneration + 1}`}{g.proposedBy === "owner" && g.origin === "evolve" ? " · by you" : ""}</td>
                <td className="px-3 py-2">{ATTEMPT_STATUS[g.status] ?? g.status}</td>
                <td className="px-3 py-2 text-right">{g.score ?? "—"}{g.baseScore !== null ? ` (was ${g.baseScore})` : ""}</td>
                <td className="px-3 py-2 text-right">{g.unitsSpent} + {g.unitsShelter}</td>
                <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">{g.note}</td>
                <td className="px-3 py-2 text-muted-foreground">{ago(g.at)}</td>
                <td className="px-3 py-2 text-right">
                  {g.status === "retired" && g.number !== null && (
                    <Button size="sm" variant="outline" disabled={rollback.isPending} title="Restore this generation's brief and skills as a new generation. Memory and tools stay as they are now. No model call." onClick={() => rollback.mutate({ residentId: g.residentId, number: g.number! })}>
                      Roll back to {g.number}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {data.heredity.log.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No resident has tried to evolve yet. Residents start it themselves in the Commons, or use “evolve” next to a resident under Live.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HeldCard({ g, onDone }: { g: Attempt; onDone: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({ mutationFn: (adopt: boolean) => client.decideEvolution({ generationId: g.id, adopt, note: note.trim() || undefined }), onSuccess: (r) => (unwrap(r), onDone()) });
  const evidence = g.evidence as { checks?: { id: string; ok: boolean; detail: string }[]; exam?: { wins: number; losses: number; ties: number; tasks: { id: string; prompt: string; base: string; candidate: string; better: string }[] } } | null;
  return (
    <div className="rounded-xl border border-primary/60 bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="display text-xl font-semibold">{g.name}: candidate for generation {g.liveGeneration + 1}</h2>
        <span className="text-sm text-muted-foreground">waiting for you · screening {g.baseScore} → {g.score}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">It passed every check and was not adopted automatically. Read the two briefs: the screening cannot see a domain rule that got lost. {g.note}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="eyebrow">Live now (generation {g.liveGeneration})</p>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap border bg-background p-3 text-xs">{g.held?.current?.systemPrompt}</pre>
          <p className="mt-1 text-xs text-muted-foreground">Skills: {g.held?.current?.skills.join(" · ") || "—"}</p>
        </div>
        <div>
          <p className="eyebrow">Candidate (AI-written from the brief on the left)</p>
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap border bg-background p-3 text-xs">{g.held?.candidate?.systemPrompt}</pre>
          <p className="mt-1 text-xs text-muted-foreground">Skills: {g.held?.candidate?.skills.join(" · ") || "—"}</p>
        </div>
      </div>
      {evidence?.checks && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Checks and blind exam</summary>
          <ul className="mt-2 space-y-1">
            {evidence.checks.map((c) => (
              <li key={c.id}>{c.ok ? "✓" : "✗"} <span className="font-mono text-xs">{c.id}</span> — {c.detail}</li>
            ))}
          </ul>
          {evidence.exam?.tasks.map((t) => (
            <div key={t.id} className="mt-3 border-t pt-2">
              <p className="text-xs font-medium">{t.prompt} <span className="text-muted-foreground">— judged better: {t.better}</span></p>
              <div className="mt-1 grid gap-2 lg:grid-cols-2">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap border bg-background p-2 text-xs">{t.base}</pre>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap border bg-background p-2 text-xs">{t.candidate}</pre>
              </div>
            </div>
          ))}
        </details>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-sm" placeholder="Note (optional, kept in the record)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>Adopt</Button>
        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Decline</Button>
      </div>
    </div>
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
        Manual payouts by decision (no Stripe Connect yet). Creator shares are owed in euros; resident wallets buy compute at {data.unitPriceCents}c/unit automatically. Shelter's cumulative 20 %:{" "}
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
                  {r.beneficiaries.length > 0 && !(r.beneficiaries.length === 1 && r.beneficiaries[0]!.name === r.creatorName) && (
                    <span className="block text-xs">
                      Born in the shelter — owed up its lineage to: {r.beneficiaries.map((b) => `${b.name} (${b.pct} %, ${b.contact})`).join("; ")}
                    </span>
                  )}
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
