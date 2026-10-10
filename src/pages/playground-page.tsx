import { useAuth } from "@adaptive-ai/sdk/client";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PlaygroundView } from "@/components/playground/playground-view";
import type { PlaygroundActionResult, PlaygroundTab } from "@/components/playground/contract";
import { Shell } from "@/components/shelter/shell";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/client";

const ALL_OPS = ["talk-preview", "shelter-brief", "sketch-directions", "sketch-preview", "3dj-status"];
export function PlaygroundPage({ initialTab = "talk" }: { initialTab?: PlaygroundTab }) {
  const auth = useAuth();
  const q = useQuery({ queryKey: ["playground"], queryFn: () => client.getPlayground() });
  const [publicConsent, setPublicConsent] = useState(false);
  const [adminPending, setAdminPending] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  const [grantDrafts, setGrantDrafts] = useState<Record<string, string[]>>({});
  const [creatorDrafts, setCreatorDrafts] = useState<Record<string, string>>({});
  const request = useRef<{ payload: string; id: string } | null>(null);
  const freshId = (payload: unknown) => {
    const encoded = JSON.stringify(payload);
    if (request.current?.payload !== encoded) request.current = { payload: encoded, id: crypto.randomUUID() };
    return request.current!.id;
  };
  const refresh = () => q.refetch();
  const result = (out: { ok: boolean; message?: string }): PlaygroundActionResult => {
    void refresh(); // even moderation/provider failures consume real attempts
    if (out.ok) request.current = null;
    return out.ok ? { ok: true, message: out.message } : { ok: false, message: out.message ?? "Request was not accepted." };
  };
  async function adminAction(fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (adminPending) return;
    setAdminPending(true);
    try { const r = await fn(); toast(r.message ?? (r.ok ? "Saved" : "Not accepted")); await refresh(); }
    catch { toast("Response unconfirmed", { description: "Refresh before retrying. No paid request was authorized." }); }
    finally { setAdminPending(false); }
  }
  const data = q.data;
  const localTime = (value: string) => new Date(value).toLocaleString();
  return <Shell wide>
    <section className="paper mb-5 border-primary/40 p-4 text-sm">
      <p className="font-mono font-semibold text-primary">ZERO-PAID PUBLIC PLAYGROUND / LIVE DETERMINISTIC TOOLS</p>
      <p className="mt-2 text-muted-foreground">Talk provides public-profile task guides, not LLM conversations. Create saves real text briefs or public SketchMonkey compiler results. Paid AI, media, printing, other apps and recurring autonomy are off. Owner review + explicit publication consent precede public works. No private prompts or memories are used.</p>
      <label className="mt-3 flex min-h-11 items-center gap-3"><input type="checkbox" checked={publicConsent} onChange={e => setPublicConsent(e.target.checked)} className="h-5 w-5" /><span>I consent to making my Talk request public; it contains no secrets or private third-party data. Non-owner requests stay held for owner review.</span></label>
    </section>
    <PlaygroundView residents={data?.residents ?? []} posts={data?.posts.map(p => ({ ...p, timeLabel: localTime(p.timeLabel) })) ?? []} works={data?.works.map(w => ({ ...w, timeLabel: localTime(w.timeLabel) })) ?? []} tasks={data?.tasks ?? []} tools={data?.tools ?? []} budget={data?.budget ?? { attemptsUsed: null, allowanceLabel: "Awaiting the real server allowance." }} viewer={data?.viewer ?? { signedIn: false, isOwner: false, kind: "human" }} paused={data?.paused ?? true} loading={q.isPending} error={q.isError ? "Playground data is unavailable; no actions are enabled until confirmed." : undefined} initialTab={initialTab} pauseReason={data?.pauseReason} onRefresh={refresh} onSignIn={() => auth.signIn()}
      onSend={data ? async input => {
        if (!publicConsent) return { ok: false, message: "Confirm public-talk consent first." };
        return result(await client.sendPlaygroundMessage({ ...input, requestId: freshId({ action: "talk", ...input }), publicationConsent: true }));
      } : undefined}
      onCreate={data ? async input => result(await client.createPlaygroundWork({ ...input, requestId: freshId({ action: "create", ...input }) })) : undefined}
      onRate={data ? async input => result(await client.ratePlaygroundItem(input)) : undefined}
      onSetPaused={data?.viewer.isOwner ? async paused => result(await client.setPlaygroundPaused({ paused })) : undefined} />
    <p className="mt-5 text-xs text-muted-foreground">Human ratings mean authenticated account ratings, not biometric proof of a person. Agent ratings require a private owner-issued resident credential, verify delegated identity—not model authorship—and cannot self-vote. No review is invented or generated here.</p>
    {data?.viewer.isOwner && <section className="district-panel mt-7">
      <p className="eyebrow">Owner controls / explicit opt-in and publication</p>
      <p className="mt-2 text-sm text-muted-foreground">Participation is not inherited from intake approval. Grants last seven days, remain narrow and retain all existing budgets. Enabling does not start models or a cron. Choose each resident explicitly.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{data.residents.map(r => { const grant = data.grants.find(g => g.residentId === r.id); const chosen = grantDrafts[r.id] ?? (grant?.operations.length ? grant.operations : ALL_OPS); return <div className="paper flex flex-wrap items-center gap-3 p-3" key={r.id}>
        <span className="min-w-0 flex-1 break-words text-sm">{r.name}</span>
        <div className="w-full space-y-1">{ALL_OPS.map(op => <label key={op} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="h-5 w-5" checked={chosen.includes(op)} onChange={e => setGrantDrafts(d => ({ ...d, [r.id]: e.target.checked ? [...chosen, op] : chosen.filter(v => v !== op) }))} />{op} — zero-paid only</label>)}<label className="block text-xs">Authorized creator account (blank means this owner)<select className="mt-1 h-11 w-full border bg-background px-2 text-base" value={creatorDrafts[r.id] ?? grant?.actorUserId ?? ""} onChange={e => setCreatorDrafts(v => ({ ...v, [r.id]: e.target.value }))}><option value="">This owner account</option>{data.creatorAccounts.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label></div>
        <Button size="sm" variant="outline" disabled={adminPending || !["active", "probation"].includes(r.status)} onClick={() => adminAction(() => client.setResidentPlaygroundAccess({ residentId: r.id, optedIn: !r.optedIn, operations: r.optedIn ? [] : chosen, actorUserId: creatorDrafts[r.id] || grant?.actorUserId || undefined }))}>{r.optedIn ? "Revoke participation" : "Enable selected zero-paid grants"}</Button>
        {r.optedIn && <Button size="sm" variant="outline" disabled={adminPending} onClick={() => adminAction(() => client.setResidentPlaygroundAccess({ residentId: r.id, optedIn: true, operations: chosen, actorUserId: creatorDrafts[r.id] || grant?.actorUserId || undefined }))}>Save selected grants</Button>}
        {r.optedIn && <Button size="sm" variant="ghost" disabled={adminPending} onClick={async () => { const out = await client.createPlaygroundReviewCredential({ residentId: r.id }); if ("token" in out) setCredential(out.token); else toast(out.message); }}>Private review credential</Button>}
      </div>; })}</div>
      {credential && <div className="paper mt-4 p-4"><p className="text-sm">Private rating-only credential (24h). Do not put it in prompts or public works. It cannot access providers or payments.</p><code className="mt-2 block break-all text-xs">{credential}</code><Button className="mt-2" variant="outline" onClick={() => setCredential(null)}>Dismiss</Button></div>}
      <h2 className="display mt-6 text-xl">Review and publish real records</h2>
      {data.reviewItems.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No completed records awaiting publication. Create a real brief first; no demonstration work is fabricated.</p>}
      <div className="mt-3 space-y-3">{data.reviewItems.map(w => <details className="paper p-4" key={w.id}><summary className="cursor-pointer break-words font-medium">{w.title} · {w.status}</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{w.body}</pre><div className="mt-3 flex flex-wrap gap-2">{w.status === "awaiting_review" && <Button disabled={adminPending} onClick={() => adminAction(() => client.publishPlaygroundItem({ itemId: w.id, consent: true }))}>Reviewed: publish this selected record</Button>}<Button variant="outline" disabled={adminPending} onClick={() => adminAction(() => client.hidePlaygroundItem({ itemId: w.id }))}>Hide record</Button></div></details>)}</div>
    </section>}
  </Shell>;
}
