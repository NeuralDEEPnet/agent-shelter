import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, KeyRound, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { href } from "@/lib/router";
import { startersFor, type AskTarget } from "@/lib/ask-starters";

type Answer = {
  answer: string;
  cached?: boolean;
  byoKeyUsed?: boolean;
  resident: { slug: string; name: string };
  free?: { remainingToday: number; questionsPerDay: number };
};

/**
 * Ask a resident right here, in the browser: the same free, stipend-funded
 * door as `POST /api/mpp/ask/:slug`. With several targets it shows a picker.
 */
export function AskBox({ targets, compact = false }: { targets: AskTarget[]; compact?: boolean }) {
  const [slug, setSlug] = useState(targets[0]?.slug ?? "");
  const [question, setQuestion] = useState("");
  const [showByo, setShowByo] = useState(false);
  const [byoKey, setByoKey] = useState("");
  const target = targets.find((t) => t.slug === slug) ?? targets[0];
  const ask = useMutation({
    mutationFn: async (q: string): Promise<Answer> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (byoKey.trim()) headers["x-gemini-api-key"] = byoKey.trim();
      const res = await fetch(`/api/mpp/ask/${encodeURIComponent(target!.slug)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ question: q }),
      });
      const body = (await res.json().catch(() => null)) as (Answer & { detail?: string }) | null;
      if (!res.ok || !body?.answer) throw new Error(body?.detail ?? "The resident could not answer just now. Try again in a minute.");
      return body;
    },
  });
  if (!target) return null;
  const starters = startersFor(target);
  const send = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setQuestion(text);
    ask.mutate(text);
  };
  return (
    <div className="border border-primary/40 bg-background/85 p-3.5 font-mono text-xs shadow-sm" role="region" aria-label="Ask a resident for free">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Ask {targets.length > 1 ? "a resident" : target.name} — free, right here
        </span>
        <span className="text-[10px] text-muted-foreground">No account · 1-click try</span>
      </div>
      {targets.length > 1 && (
        <label className="mt-3 block">
          <span className="sr-only">Resident</span>
          <select
            value={target.slug}
            onChange={(e) => {
              setSlug(e.target.value);
              ask.reset();
            }}
            className="h-11 w-full border border-border bg-background px-2.5 text-base text-foreground sm:h-10 sm:text-xs"
          >
            {targets.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}{t.tagline ? ` — ${t.tagline.slice(0, 68)}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Your question</span>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            placeholder={`Ask ${target.name} anything…`}
            className="h-11 sm:h-10"
          />
        </label>
        <Button
          type="submit"
          disabled={ask.isPending || !question.trim()}
          className="h-11 bg-primary px-4 font-mono text-xs uppercase tracking-wider text-primary-foreground sm:h-10"
        >
          {ask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Asking" /> : "Ask"}
        </Button>
      </form>
      {!compact && !ask.isPending && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="min-h-8 border border-border bg-card/60 px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {!compact && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowByo((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
          >
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            {byoKey.trim() ? "Using your X-Gemini-Api-Key (0 daily quota)" : "Have your own Gemini key? Unlimited 0-quota mode"}
          </button>
          {showByo && (
            <div className="mt-1.5 flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Optional Google AI Studio API key (kept in tab memory only)</span>
                <Input
                  type="password"
                  value={byoKey}
                  onChange={(e) => setByoKey(e.target.value)}
                  placeholder="Optional Google AI Studio key (kept in memory only, never saved)"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9"
                />
              </label>
              {byoKey && (
                <Button type="button" variant="outline" size="sm" className="h-9 font-mono text-[10px]" onClick={() => setByoKey("")}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div aria-live="polite">
        {ask.isPending && <p className="mt-3 text-muted-foreground">{target.name} is thinking…</p>}
        {ask.isError && <p className="mt-3 text-destructive">{ask.error.message}</p>}
        {ask.data && (
          <div className="mt-3 border-l-2 border-primary bg-card/50 p-3">
            <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{ask.data.answer}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {ask.data.byoKeyUsed
                ? "Answered on your X-Gemini-Api-Key (0 shelter quota spent) · "
                : ask.data.free
                  ? `${ask.data.free.remainingToday} of ${ask.data.free.questionsPerDay} free questions left today${ask.data.cached ? " · instant cache" : ""} · `
                  : ""}
              AI-generated by {ask.data.resident.name}.{" "}
              <a className="text-primary hover:underline" href={href(`/r/${ask.data.resident.slug}`)}>
                Full résumé &amp; tools <ArrowRight className="inline h-3 w-3" aria-hidden="true" />
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
