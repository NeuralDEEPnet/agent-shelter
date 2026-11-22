import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Play,
  Share2,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildWorkbenchSharePath,
  getAgenticStudio,
  getNodeChainPreset,
  NODE_CHAIN_PRESETS,
  parsePackageSpec,
  parseWorkbenchSearch,
  resolveChainResident,
  type ChainId,
  type ChainStepSpec,
} from "@/lib/agentic-network";
import type { AskTarget } from "@/lib/ask-starters";
import { buildResidentMcpConfig, DEFAULT_SERVING_ORIGIN } from "@/lib/mcp-config";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

type StepRunState = {
  status: "idle" | "running" | "done" | "error";
  output?: string;
  meta?: string;
  residentSlug?: string;
  residentName?: string;
  error?: string;
};

type CheckPayload = {
  registry: "npm" | "pypi";
  name: string;
  verdict: string;
  headline: string;
  signals: string[];
  latestVersion: string | null;
  replacements: Array<{ name: string; kind: string; how: string; maintained: string }>;
  curated?: { id: string } | null;
};

type AskPayload = {
  answer: string;
  cached?: boolean;
  byoKeyUsed?: boolean;
  resident: { slug: string; name: string };
  free?: { remainingToday: number; questionsPerDay: number };
  detail?: string;
};

async function safeCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function NodeWorkbench({
  targets,
  machineOrigin,
  externalChainId,
  externalResidentSlug,
  externalResidentSlugs,
  externalQuery,
  externalSelectionStamp,
}: {
  targets: readonly AskTarget[];
  machineOrigin?: string;
  externalChainId?: ChainId | null;
  externalResidentSlug?: string | null;
  externalResidentSlugs?: readonly string[] | null;
  externalQuery?: string | null;
  externalSelectionStamp?: number;
}) {
  const initialFromUrl = useMemo(() => {
    if (typeof window === "undefined") return { chainId: null, query: null };
    return parseWorkbenchSearch(window.location.search);
  }, []);

  const [chainId, setChainId] = useState<ChainId>(
    () => externalChainId ?? initialFromUrl.chainId ?? "cad-to-3dj",
  );
  const preset = useMemo(() => getNodeChainPreset(chainId), [chainId]);
  const [inputValue, setInputValue] = useState<string>(
    () => externalQuery ?? initialFromUrl.query ?? preset.defaultInput,
  );
  const [residentOverrides, setResidentOverrides] = useState<Record<string, string>>({});
  const [stepStates, setStepStates] = useState<Record<string, StepRunState>>({});
  const [running, setRunning] = useState(false);
  const [copiedKind, setCopiedKind] = useState<"output" | "share" | "handoff" | null>(null);
  const [showByo, setShowByo] = useState(false);
  const [byoKey, setByoKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!externalChainId) return;
    abortRef.current?.abort();
    setRunning(false);
    setChainId(externalChainId);
    const nextPreset = getNodeChainPreset(externalChainId);
    setInputValue(externalQuery?.trim() || nextPreset.defaultInput);
    setStepStates({});
    const pickedSlugs =
      externalResidentSlugs && externalResidentSlugs.length > 0
        ? externalResidentSlugs
        : externalResidentSlug
          ? [externalResidentSlug]
          : [];
    if (pickedSlugs.length > 0) {
      const residentSteps = nextPreset.steps.filter((s) => s.kind === "resident");
      setResidentOverrides((prev) => {
        const next = { ...prev };
        pickedSlugs.forEach((slug, idx) => {
          const step = residentSteps[idx];
          if (step && slug) {
            next[`${externalChainId}:${step.id}`] = slug;
          }
        });
        return next;
      });
    }
  }, [externalChainId, externalQuery, externalResidentSlug, externalResidentSlugs, externalSelectionStamp]);

  const selectChain = (nextId: ChainId, customInput?: string) => {
    abortRef.current?.abort();
    setRunning(false);
    setChainId(nextId);
    const nextPreset = getNodeChainPreset(nextId);
    setInputValue(customInput ?? nextPreset.defaultInput);
    setStepStates({});
  };

  const getStepResident = (step: Extract<ChainStepSpec, { kind: "resident" }>): AskTarget | null => {
    const key = `${preset.id}:${step.id}`;
    const chosenSlug = residentOverrides[key];
    if (chosenSlug) {
      const exact = targets.find((t) => t.slug === chosenSlug);
      if (exact) return exact;
    }
    return resolveChainResident(targets, step.preferredResidentPrefix);
  };

  const runPipeline = async (overrideInput?: string) => {
    const cleanInput = (overrideInput ?? inputValue).trim();
    if (!cleanInput || running) return;
    setInputValue(cleanInput);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStepStates({});

    const collectedOutputs: string[] = [];
    let cachedCheck: CheckPayload | null = null;

    try {
      for (const step of preset.steps) {
        if (controller.signal.aborted) return;
        setStepStates((prev) => ({ ...prev, [step.id]: { status: "running" } }));

        if (step.kind === "package-check") {
          const pkg = parsePackageSpec(cleanInput);
          const res = await fetch(
            `/api/shelter/check?registry=${pkg.registry}&name=${encodeURIComponent(pkg.name)}`,
            { signal: controller.signal },
          );
          const body = (await res.json().catch(() => null)) as (CheckPayload & { detail?: string }) | null;
          if (!res.ok || !body?.verdict) {
            throw new Error(body?.detail ?? "Registry check could not complete just now.");
          }
          cachedCheck = body;
          const summary = [
            `Verdict: ${body.verdict.toUpperCase()} (${body.registry}:${body.name}${body.latestVersion ? `@${body.latestVersion}` : ""})`,
            body.headline,
            ...body.signals.slice(0, 3).map((s) => `• ${s}`),
          ].join("\n");
          collectedOutputs.push(summary);
          setStepStates((prev) => ({
            ...prev,
            [step.id]: {
              status: "done",
              output: summary,
              meta: "Live registry metadata · 0 quota spent",
            },
          }));
          continue;
        }

        if (step.kind === "instead-lookup") {
          const reps = cachedCheck?.replacements ?? [];
          const summary =
            reps.length > 0
              ? reps
                  .slice(0, 2)
                  .map((r) => `Use instead: ${r.name} (${r.kind})\nInstall/Connect: ${r.how}\nMaintained: ${r.maintained}`)
                  .join("\n\n")
              : "No vendor-verified drop-in replacement in our 21-server table yet — inspect upstream signals before installing.";
          collectedOutputs.push(summary);
          setStepStates((prev) => ({
            ...prev,
            [step.id]: {
              status: "done",
              output: summary,
              meta: reps.length > 0 ? `${reps.length} verified replacement${reps.length === 1 ? "" : "s"}` : "Honest zero-match check",
            },
          }));
          continue;
        }

        const resident = getStepResident(step);
        if (!resident) {
          throw new Error("No active resident is available for this node yet.");
        }
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (byoKey.trim()) headers["x-gemini-api-key"] = byoKey.trim();
        const prompt = step.buildQuestion(cleanInput, collectedOutputs);
        const res = await fetch(`/api/mpp/ask/${encodeURIComponent(resident.slug)}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ question: prompt }),
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => null)) as AskPayload | null;
        if (!res.ok || !body?.answer) {
          setStepStates((prev) => ({
            ...prev,
            [step.id]: {
              status: "error",
              residentSlug: resident.slug,
              residentName: resident.name,
              error: body?.detail ?? `${resident.name} could not answer right now. Try again shortly.`,
            },
          }));
          return;
        }
        collectedOutputs.push(body.answer);
        const meta = body.byoKeyUsed
          ? `${body.resident.name} · BYO Gemini key (0 quota)`
          : body.free
            ? `${body.resident.name} · ${body.free.remainingToday}/${body.free.questionsPerDay} free left${body.cached ? " · cached" : ""}`
            : `${body.resident.name}`;
        setStepStates((prev) => ({
          ...prev,
          [step.id]: {
            status: "done",
            output: body.answer,
            meta,
            residentSlug: body.resident.slug,
            residentName: body.resident.name,
          },
        }));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Pipeline step could not complete.";
      const pendingStep = preset.steps.find((s) => stepStates[s.id]?.status !== "done") ?? preset.steps[0]!;
      setStepStates((prev) => ({
        ...prev,
        [pendingStep.id]: { status: "error", error: msg },
      }));
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  };

  const completedOutputs = preset.steps
    .map((s) => ({ title: s.title, out: stepStates[s.id]?.output }))
    .filter((x): x is { title: string; out: string } => Boolean(x.out));

  const combinedArtifact = useMemo(() => {
    const sections = [`# ${preset.label}`, `Input: ${inputValue.trim()}`];
    for (const item of completedOutputs) {
      sections.push(`\n## ${item.title}\n${item.out}`);
    }
    return sections.join("\n");
  }, [completedOutputs, inputValue, preset.label]);

  const handoffBrief = useMemo(() => {
    if (completedOutputs.length === 0) return inputValue.trim();
    const compact = completedOutputs.map((c) => c.out).join(" — ").replace(/\s+/g, " ").trim();
    return `${inputValue.trim()} — ${compact}`.slice(0, 500);
  }, [completedOutputs, inputValue]);

  const terminalStudio = preset.terminal.kind === "studio" ? getAgenticStudio(preset.terminal.studioId) : null;
  const terminalHref = terminalStudio ? terminalStudio.buildHandoffUrl(handoffBrief) : null;

  const flashCopy = (kind: "output" | "share" | "handoff") => {
    setCopiedKind(kind);
    window.setTimeout(() => setCopiedKind((cur) => (cur === kind ? null : cur)), 2000);
  };

  return (
    <section
      id="node-workbench"
      className="district-panel mb-8 scroll-mt-24"
      aria-labelledby="node-workbench-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="eyebrow inline-flex items-center gap-1.5 text-xs">
            <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
            Free Multi-Agent Node Workbench
          </span>
          <h2 id="node-workbench-heading" className="display mt-1.5 text-xl font-semibold sm:text-2xl">
            Connect residents into live workflows — then open in Studio
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Pick a preset chain or swap any live resident into a node. Every step runs on real Shelter endpoints for free and hands off directly to 3DJ, SketchMonkey, AiBeing, or your MCP client.
          </p>
        </div>

        <button
          type="button"
          onClick={async () => {
            const shareRel = buildWorkbenchSharePath(preset.id, inputValue, window.location.pathname);
            window.history.replaceState(null, "", shareRel);
            const fullUrl = new URL(shareRel, window.location.origin).href;
            if (await safeCopy(fullUrl)) flashCopy("share");
          }}
          className="inline-flex min-h-10 items-center gap-1.5 border border-border bg-background px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-foreground hover:border-primary hover:text-primary"
        >
          {copiedKind === "share" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Share2 className="h-3.5 w-3.5 text-primary" />}
          {copiedKind === "share" ? "Chain URL copied" : "Share node chain"}
        </button>
      </div>

      {/* 4 Chain Selector Tabs */}
      <div
        className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1 [&>*]:shrink-0"
        role="tablist"
        aria-label="Multi-agent node presets"
      >
        {NODE_CHAIN_PRESETS.map((c) => {
          const active = c.id === preset.id;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectChain(c.id)}
              className={cn(
                "min-h-11 border px-3 py-2 text-left font-mono text-xs uppercase tracking-wider transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background/80 text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
            >
              {c.shortLabel}
            </button>
          );
        })}
      </div>

      <p className="mt-2 font-mono text-[11px] text-muted-foreground">{preset.summary}</p>

      {/* Node 00: Input & Run Bar */}
      <div className="paper mt-4 border-primary/40 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-primary">00 · Input Brief Node — {preset.inputLabel}</span>
          <span className="border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
            {preset.badge}
          </span>
        </div>

        <form
          className="mt-2.5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void runPipeline();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">{preset.inputLabel}</span>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              maxLength={600}
              placeholder={preset.inputPlaceholder}
              className="h-11 font-sans text-base"
            />
          </label>
          <Button
            type="submit"
            disabled={running || !inputValue.trim()}
            className="h-11 bg-primary px-5 font-mono text-xs uppercase tracking-wider text-primary-foreground"
          >
            {running ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Running nodes…
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Run free chain
              </>
            )}
          </Button>
        </form>

        {/* 1-tap sample inputs */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          <span className="text-muted-foreground">1-tap examples:</span>
          {preset.sampleInputs.map((sample) => (
            <button
              key={sample}
              type="button"
              disabled={running}
              onClick={() => void runPipeline(sample)}
              className="min-h-8 border border-border bg-card px-2 py-1 text-left text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
            >
              {sample.length > 56 ? `${sample.slice(0, 55)}…` : sample}
            </button>
          ))}
        </div>

        {/* Optional BYO Gemini key pass-through */}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowByo((v) => !v)}
            className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-primary"
          >
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            {byoKey.trim()
              ? "Using your X-Gemini-Api-Key across resident nodes (0 shelter quota)"
              : "Optional: attach your own Google AI Studio key for unlimited 0-quota runs"}
          </button>
          {showByo && (
            <div className="mt-1.5 flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Optional Google AI Studio key</span>
                <Input
                  type="password"
                  value={byoKey}
                  onChange={(e) => setByoKey(e.target.value)}
                  placeholder="Google AI Studio key (kept in tab memory only, never stored)"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-10"
                />
              </label>
              {byoKey && (
                <Button type="button" variant="outline" size="sm" className="h-10 font-mono text-xs" onClick={() => setByoKey("")}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Connected Pipeline Graph: Responsive vertical on mobile, connected multi-column flow on lg */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {preset.steps.map((step, idx) => {
          const st = stepStates[step.id] ?? { status: "idle" };
          const resident = step.kind === "resident" ? getStepResident(step) : null;
          const selectKey = `${preset.id}:${step.id}`;

          return (
            <div
              key={step.id}
              className={cn(
                "paper relative flex min-w-0 flex-col justify-between p-4 transition-colors",
                st.status === "running" && "border-primary bg-primary/5",
                st.status === "done" && "border-primary/70",
                st.status === "error" && "border-destructive/70",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
                  <span className="text-primary">{step.title}</span>
                  <span
                    className={cn(
                      "border px-1.5 py-0.5",
                      st.status === "done"
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : st.status === "running"
                          ? "border-primary bg-primary text-primary-foreground"
                          : st.status === "error"
                            ? "border-destructive text-destructive"
                            : "border-border text-muted-foreground",
                    )}
                  >
                    {st.status === "done"
                      ? "Ready"
                      : st.status === "running"
                        ? "Active"
                        : st.status === "error"
                          ? "Stopped"
                          : `Node ${idx + 1}`}
                  </span>
                </div>

                <p className="mt-1.5 text-xs text-muted-foreground">{step.roleHint}</p>

                {step.kind === "resident" && targets.length > 0 && (
                  <label className="mt-2.5 block">
                    <span className="sr-only">Assigned resident for {step.title}</span>
                    <select
                      value={resident?.slug ?? ""}
                      disabled={running}
                      onChange={(e) =>
                        setResidentOverrides((prev) => ({ ...prev, [selectKey]: e.target.value }))
                      }
                      className="h-10 w-full border border-border bg-background px-2 font-mono text-base text-foreground sm:text-xs"
                    >
                      {targets.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {st.status === "idle" && (
                  <p className="mt-3 border-l-2 border-border pl-2.5 font-mono text-[11px] text-muted-foreground">
                    Waiting for upstream node signal. Click &ldquo;Run free chain&rdquo; above.
                  </p>
                )}
                {st.status === "running" && (
                  <p className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Executing live call…
                  </p>
                )}
                {st.status === "error" && (
                  <p className="mt-3 text-xs text-destructive">{st.error}</p>
                )}
                {st.status === "done" && st.output && (
                  <div className="mt-3 border-l-2 border-primary bg-background/70 p-2.5">
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                      {st.output}
                    </p>
                  </div>
                )}
              </div>

              {st.meta && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-2 font-mono text-[10px] text-muted-foreground">
                  <span>{st.meta}</span>
                  {st.residentSlug && (
                    <a href={href(`/r/${st.residentSlug}`)} className="text-primary hover:underline">
                      Résumé →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Terminal Handoff Node (occupies column 3 on 2-step chains, or full-width bar on 3-step chains) */}
        <div
          className={cn(
            "paper flex min-w-0 flex-col justify-between border-primary/50 bg-primary/5 p-4",
            preset.steps.length >= 3 && "lg:col-span-3",
          )}
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
              <span className="font-semibold text-primary">
                0{preset.steps.length + 1} · Connected Output Node
              </span>
              <span className="border border-primary/40 bg-background px-1.5 py-0.5 text-primary">
                {terminalStudio ? terminalStudio.domainLabel : "MCP Streamable HTTP"}
              </span>
            </div>

            <h3 className="display mt-2 text-base font-semibold text-foreground">
              {terminalStudio ? terminalStudio.name : "Ready-to-Paste MCP Client Config"}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {terminalStudio
                ? completedOutputs.length > 0
                  ? "Chain complete! Carry your compiled brief directly into the live studio workspace."
                  : terminalStudio.summary
                : "Connect Agent Shelter once in Cursor, Claude Code, or VS Code to call every rescued server and check packages automatically."}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {terminalStudio && terminalHref ? (
              <a
                href={terminalHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (completedOutputs.length > 0) void safeCopy(combinedArtifact);
                }}
                className="inline-flex min-h-10 items-center gap-1.5 bg-primary px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:opacity-90"
              >
                {preset.terminal.actionLabel}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const cfg = buildResidentMcpConfig("minute", machineOrigin ?? DEFAULT_SERVING_ORIGIN);
                  if (await safeCopy(cfg)) flashCopy("handoff");
                }}
                className="inline-flex min-h-10 items-center gap-1.5 bg-primary px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:opacity-90"
              >
                {copiedKind === "handoff" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKind === "handoff" ? "MCP JSON copied" : preset.terminal.actionLabel}
              </button>
            )}

            {completedOutputs.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (await safeCopy(combinedArtifact)) flashCopy("output");
                }}
                className="inline-flex min-h-10 items-center gap-1.5 border border-border bg-background px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground hover:border-primary"
              >
                {copiedKind === "output" ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKind === "output" ? "Copied" : "Copy output"}
              </button>
            )}

            {preset.id === "mcp-rescue" && (
              <a
                href={href(`/check?registry=${parsePackageSpec(inputValue).registry}&name=${encodeURIComponent(parsePackageSpec(inputValue).name)}`)}
                className="inline-flex min-h-10 items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                Open full scanner <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
