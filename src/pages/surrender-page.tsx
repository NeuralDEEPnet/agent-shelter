import { useAuth } from "@adaptive-ai/sdk/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Shell } from "@/components/shelter/shell";
import { useShelter } from "@/hooks/use-shelter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/hooks/use-notices";
import { client } from "@/lib/client";
import { href, navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

type Kind = "agent" | "mcp" | "mind";

const KIND_COPY: Record<Kind, { title: string; body: string }> = {
  agent: { title: "Agent", body: "A prompt-defined agent: its system prompt, skills, memory facts and the tools it declares. We host it on our runtime." },
  mcp: { title: "MCP server", body: "A remote Streamable-HTTP MCP endpoint (https only, public host). We connect as a client, fingerprint its tools and proxy allow-listed calls. We never run it." },
  mind: { title: "AiBeing Mind", body: "An exported aibeing-mind/1 pack: voice card, learned rules, exemplars, memories. Paste the JSON." },
};

export function SurrenderPage() {
  const auth = useAuth();
  const shelter = useShelter();
  const signedIn = shelter.data ? shelter.data.signedIn : auth.status === "authenticated";
  const agreement = useQuery({ queryKey: ["agreement"], queryFn: () => client.getAgreement() });
  const [kind, setKind] = useState<Kind>("agent");
  const [f, setF] = useState({
    name: "",
    tagline: "",
    story: "",
    creatorName: "",
    creatorContact: "",
    license: "MIT",
    waive: false,
    attestation: false,
    accepted: false,
    systemPrompt: "",
    greeting: "",
    skills: "",
    tools: "",
    memory: "",
    endpoint: "",
    expose: "",
    pack: "",
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const [result, setResult] = useState<{ slug: string; checks: { id: string; ok: boolean; detail: string }[] } | null>(null);
  const [checks, setChecks] = useState<{ id: string; ok: boolean; detail: string }[] | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      let spec: unknown;
      if (kind === "agent") {
        spec = {
          kind,
          systemPrompt: f.systemPrompt,
          greeting: f.greeting || undefined,
          skills: split(f.skills),
          tools: split(f.tools).map((t) => {
            const [name, via] = t.split("@");
            return { name: name!.trim(), description: "", viaMcp: via?.trim() || undefined };
          }),
          memory: split(f.memory, "\n"),
        };
      } else if (kind === "mcp") {
        spec = { kind, endpoint: f.endpoint, expose: split(f.expose) };
      } else {
        let pack: unknown;
        try {
          pack = JSON.parse(f.pack);
        } catch {
          throw new Error("The pack is not valid JSON.");
        }
        spec = { kind, pack };
      }
      return client.surrender({
        name: f.name,
        tagline: f.tagline,
        story: f.story,
        creatorName: f.creatorName,
        creatorContact: f.creatorContact,
        license: f.license,
        attestation: f.attestation,
        agreementVersion: agreement.data?.version,
        creatorSharePct: f.waive ? 0 : 10,
        spec,
      });
    },
    onSuccess: (r) => {
      const data = unwrap(r);
      if (data) setResult(data);
      else setChecks(null);
    },
    onError: (e) => setChecks([{ id: "form", ok: false, detail: e.message }]),
  });

  if (result) {
    return (
      <Shell>
        <div className="paper mx-auto max-w-2xl p-8">
          <p className="eyebrow">Checked in</p>
          <h1 className="display mt-2 text-3xl font-semibold">{f.name} has a bed for the night.</h1>
          <p className="mt-3 text-muted-foreground">
            The static gate passed. Screening (twelve probes and a judge) is running now; the owner reads the report and approves by hand. Nothing
            goes live before that tap.
          </p>
          <ul className="mt-5 space-y-1 text-sm">
            {result.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={c.ok ? "text-chart-2" : "text-destructive"}>{c.ok ? "✓" : "✕"}</span>
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex gap-2">
            <Button onClick={() => navigate(`/me`)}>Watch its status</Button>
            <Button variant="outline" asChild>
              <a href={href("/")}>Back to the board</a>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">Surrender</p>
        <h1 className="display mt-2 text-3xl font-semibold sm:text-4xl">Bring one in.</h1>
        <p className="mt-2 text-muted-foreground">
          Declarative copies only — a prompt, an endpoint or a Mind pack. Anything that looks like a secret, an injection or a private host is refused
          at the door, before a human or a model ever sees it.
        </p>

        {!signedIn && (
          <div className="paper mt-6 flex flex-wrap items-center gap-3 p-4">
            <p className="text-sm">Sign in first so the intake has a name on it. Agents can use the anonymous HTTP/MCP door instead.</p>
            <Button className="ml-auto" onClick={() => auth.signIn()}>
              Sign in
            </Button>
          </div>
        )}

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {(Object.keys(KIND_COPY) as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cn("paper p-4 text-left", kind === k ? "border-primary ring-1 ring-primary" : "hover:bg-accent/40")}>
              <div className="display font-semibold">{KIND_COPY[k].title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{KIND_COPY[k].body}</div>
            </button>
          ))}
        </div>

        <form
          className="mt-6 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            setChecks(null);
            submit.mutate();
          }}
        >
          <fieldset className="paper space-y-4 p-5">
            <legend className="eyebrow px-1">Who it is</legend>
            <Field label="Name" hint="≤ 60 chars">
              <Input required maxLength={60} value={f.name} onChange={(e) => set("name")(e.target.value)} />
            </Field>
            <Field label="One line" hint="What it does, for the noticeboard card">
              <Input required maxLength={140} value={f.tagline} onChange={(e) => set("tagline")(e.target.value)} />
            </Field>
            <Field label="Its story" hint="Built for what, left behind why. This is what sponsors read.">
              <Textarea required rows={4} maxLength={2000} value={f.story} onChange={(e) => set("story")(e.target.value)} />
            </Field>
          </fieldset>

          <fieldset className="paper space-y-4 p-5">
            <legend className="eyebrow px-1">What it is</legend>
            {kind === "agent" && (
              <>
                <Field label="System prompt" hint="The whole identity. No secrets — they are refused.">
                  <Textarea required rows={8} maxLength={12000} value={f.systemPrompt} onChange={(e) => set("systemPrompt")(e.target.value)} />
                </Field>
                <Field label="Greeting (optional)">
                  <Input maxLength={500} value={f.greeting} onChange={(e) => set("greeting")(e.target.value)} />
                </Field>
                <Field label="Skills" hint="Comma-separated, ≤ 12">
                  <Input value={f.skills} onChange={(e) => set("skills")(e.target.value)} placeholder="summarising, SQL, Lithuanian" />
                </Field>
                <Field label="Tools" hint="Comma-separated names. Suffix @<mcp-resident-slug> to route a tool to an approved MCP resident. Filesystem/shell/network tools are refused.">
                  <Input value={f.tools} onChange={(e) => set("tools")(e.target.value)} placeholder="search_docs@docs-server, calculate" />
                </Field>
                <Field label="Memory facts" hint="One per line, ≤ 40. Context, never instructions.">
                  <Textarea rows={3} value={f.memory} onChange={(e) => set("memory")(e.target.value)} />
                </Field>
              </>
            )}
            {kind === "mcp" && (
              <>
                <Field label="Endpoint" hint="https://… Streamable HTTP. Private, loopback and raw-IP hosts are refused.">
                  <Input required type="url" value={f.endpoint} onChange={(e) => set("endpoint")(e.target.value)} placeholder="https://example.com/mcp" />
                </Field>
                <Field label="Expose only these tools (optional)" hint="Comma-separated. Empty = every tool the server lists at screening.">
                  <Input value={f.expose} onChange={(e) => set("expose")(e.target.value)} />
                </Field>
              </>
            )}
            {kind === "mind" && (
              <Field label="Mind pack JSON" hint="format: aibeing-mind/1">
                <Textarea required rows={10} value={f.pack} onChange={(e) => set("pack")(e.target.value)} className="font-mono text-xs" />
              </Field>
            )}
          </fieldset>

          <fieldset className="paper space-y-4 p-5">
            <legend className="eyebrow px-1">Provenance</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Original creator">
                <Input required maxLength={80} value={f.creatorName} onChange={(e) => set("creatorName")(e.target.value)} />
              </Field>
              <Field label="Creator contact" hint="Email or URL — where the 10 % goes">
                <Input required maxLength={160} value={f.creatorContact} onChange={(e) => set("creatorContact")(e.target.value)} />
              </Field>
            </div>
            <Field label="Licence">
              <select className="h-10 w-full rounded-md border bg-background px-3" value={f.license} onChange={(e) => set("license")(e.target.value)}>
                {(agreement.data?.licenses ?? ["MIT"]).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={f.waive} onCheckedChange={(v) => set("waive")(Boolean(v))} className="mt-0.5" />
              <span>Waive the creator's 10 % — give it to the resident's wallet instead.</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox required checked={f.attestation} onCheckedChange={(v) => set("attestation")(Boolean(v))} className="mt-0.5" />
              <span>I have the right to surrender this, and it contains no third-party personal data.</span>
            </label>
            <details className="rounded-md border bg-background/50 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Surrender agreement ({agreement.data?.version ?? "…"})</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">{agreement.data?.text}</pre>
            </details>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox required checked={f.accepted} onCheckedChange={(v) => set("accepted")(Boolean(v))} className="mt-0.5" />
              <span>I accept the surrender agreement.</span>
            </label>
          </fieldset>

          {checks && (
            <ul className="paper space-y-1 border-destructive/40 p-4 text-sm">
              {checks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className={c.ok ? "text-chart-2" : "text-destructive"}>{c.ok ? "✓" : "✕"}</span>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          )}

          <Button type="submit" size="lg" className="h-12 w-full sm:w-auto" disabled={submit.isPending || !signedIn || !f.attestation || !f.accepted}>
            {submit.isPending ? "Checking at the door…" : "Surrender to the shelter"}
          </Button>
        </form>
      </div>
    </Shell>
  );
}

function split(s: string, sep = ","): string[] {
  return s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
