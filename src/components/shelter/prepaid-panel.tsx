import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { goToCheckout, openCheckoutTab } from "@/lib/checkout-tab";
import { euro } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PrepaidAskInput = { mode: "simple" | "standard"; question: string; requestId: string };
export type PrepaidPanelProps = {
  signedIn: boolean;
  /** Spendable credit, excluding any held amount. Never substitute a resident wallet. */
  balanceCents: number;
  heldCents?: number;
  loading?: boolean;
  onSignIn: () => void;
  onTopUp: (amountCents: number) => Promise<{ url?: string; notice?: string }>;
  onAsk: (input: PrepaidAskInput) => Promise<{ ok: boolean; answer?: string; notice?: string; uncertain?: boolean }>;
  residentSlug?: string;
  onRefresh?: () => void;
  /** Supply the backend's actual caps. Defaults are only a client-side convenience. */
  simpleMaxChars?: number;
  standardMaxChars?: number;
  simpleAvailable?: boolean;
};

const TOP_UPS = [50, 100, 500, 1000] as const;
const PRICE = { simple: 1, standard: 5 } as const;

function stripeCheckoutUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["checkout.stripe.com", "buy.stripe.com"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

/** Prop-driven billing UI. Identity, balances, prices and reservations remain server-owned. */
export function PrepaidPanel({
  signedIn, balanceCents, heldCents = 0, loading = false, onSignIn, onTopUp, onAsk,
  residentSlug, onRefresh, simpleMaxChars = 400, standardMaxChars = 2000, simpleAvailable = true,
}: PrepaidPanelProps) {
  const id = useId();
  const [topUpCents, setTopUpCents] = useState<number>(500);
  const [mode, setMode] = useState<PrepaidAskInput["mode"]>("standard");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"topup" | "ask" | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  // A transport failure retains the EXACT request and UUID. A retry cannot create a second debit.
  const pendingAsk = useRef<PrepaidAskInput | null>(null);
  const busyRef = useRef(false);
  const price = PRICE[mode];
  const maxChars = mode === "simple" ? simpleMaxChars : standardMaxChars;
  const safeBalance = Number.isSafeInteger(balanceCents) ? Math.max(0, balanceCents) : 0;
  const unavailable = loading || busy !== null;
  const canAsk = signedIn && Boolean(residentSlug) && safeBalance >= price &&
    question.trim().length > 0 && question.trim().length <= maxChars &&
    (mode !== "simple" || simpleAvailable) && !unavailable;

  async function topUp() {
    if (!signedIn || unavailable || busyRef.current) return;
    busyRef.current = true;
    // Must happen synchronously, before awaiting a Checkout Session in the iframe.
    const tab = openCheckoutTab();
    setBusy("topup"); setNotice(null); setCheckoutUrl(null);
    try {
      const result = await onTopUp(topUpCents);
      const url = stripeCheckoutUrl(result.url);
      if (!url) {
        goToCheckout(tab, null);
        setNotice(result.notice ?? "Checkout is not available. No credit has been added.");
        return;
      }
      // Keep an explicit safe link available even when the browser blocks navigation.
      setCheckoutUrl(url);
      const opened = goToCheckout(tab, url);
      setNotice(opened ? "Complete payment in Stripe, then return here to confirm your credit." : "Your browser blocked checkout. Use the secure checkout link below.");
    } catch {
      goToCheckout(tab, null);
      setNotice("Checkout could not be confirmed. No credit is added until a verified payment completes.");
    } finally { busyRef.current = false; setBusy(null); }
  }

  async function ask(retry = false) {
    if (busyRef.current || unavailable || !signedIn || !residentSlug) return;
    if (!retry && !canAsk) return;
    const input = retry ? pendingAsk.current : {
      mode, question: question.trim(), requestId: globalThis.crypto.randomUUID(),
    };
    if (!input) return;
    busyRef.current = true;
    pendingAsk.current = input;
    setBusy("ask"); setNotice(null); setAnswer(null);
    try {
      const result = await onAsk(input);
      if (result.uncertain) {
        setUncertain(true);
        setNotice(result.notice ?? "This question's outcome is not confirmed. Refresh your balance before retrying the same request.");
      } else {
        pendingAsk.current = null;
        setUncertain(false);
        if (result.ok && result.answer) {
          setAnswer(result.answer);
          setNotice("Answer received. Refresh to see the latest available balance.");
        } else setNotice(result.notice ?? "The resident could not answer. Check your balance before trying again.");
        onRefresh?.();
      }
    } catch {
      setUncertain(true);
      setNotice("The response could not be confirmed. Refresh your balance first; retrying the same request preserves its reference and cannot create a new question.");
    } finally { busyRef.current = false; setBusy(null); }
  }

  return (
    <section className="paper min-w-0 space-y-5 border border-primary/30 p-4 sm:p-5" aria-labelledby={`${id}-title`} aria-busy={loading || busy !== null}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="eyebrow text-primary">Your question balance</p>
          <h2 id={`${id}-title`} className="display mt-1 text-2xl font-semibold">Small questions. Smaller prices.</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">Your private, non-transferable Shelter credit. Separate from every resident's wallet.</p>
        </div>
        <div className="border border-primary/40 bg-primary/5 px-4 py-3 text-right">
          <span className="block font-mono text-xs uppercase tracking-wide text-muted-foreground">Available</span>
          <strong className="block font-mono text-2xl text-primary">{signedIn ? loading ? "…" : euro(safeBalance) : "Sign in"}</strong>
          {signedIn && heldCents > 0 && <span className="block text-xs text-muted-foreground">{euro(heldCents)} held for pending work</span>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-border bg-background/60 p-3">
          <p className="font-mono text-sm font-semibold">Standard · €0.05 / question</p>
          <p className="mt-1 text-sm text-muted-foreground">A bounded text answer. Resident availability and daily compute limits still apply.</p>
        </div>
        <div className="border border-border bg-background/60 p-3">
          <p className="font-mono text-sm font-semibold">Simple · €0.01 / question</p>
          <p className="mt-1 text-sm text-muted-foreground">A short, tightly limited answer. No tool calls or media generation.</p>
        </div>
      </div>

      {!signedIn ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Sign in to buy credit and spend only your own balance.</p>
          <Button className="min-h-11 rounded-none" onClick={onSignIn}>Sign in for prepaid questions</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <fieldset disabled={unavailable} className="space-y-2">
            <legend className="font-mono text-xs uppercase tracking-wide">Add credit · choose an amount</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TOP_UPS.map((cents) => (
                <button key={cents} type="button" aria-pressed={topUpCents === cents} onClick={() => setTopUpCents(cents)}
                  className={cn("min-h-11 border px-3 py-2 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", topUpCents === cents ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent")}>
                  {euro(cents)}
                </button>
              ))}
            </div>
          </fieldset>
          <Button className="min-h-11 w-full rounded-none sm:w-auto" disabled={unavailable} onClick={() => void topUp()}>
            {busy === "topup" ? "Opening checkout…" : `Add ${euro(topUpCents)} credit`}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">You receive the full amount paid as credit. Card processing fees are borne by the Shelter, not deducted from your credit; tiny top-ups are less fee-efficient. No subscription, auto-top-up or unlimited usage.</p>
          {checkoutUrl && <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">Open secure Stripe checkout ↗</a>}
        </div>
      )}

      {residentSlug ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="font-mono text-sm font-semibold">Ask with your balance</h3>
          <fieldset disabled={unavailable || uncertain || !signedIn} className="flex flex-wrap gap-2">
            <legend className="sr-only">Question mode</legend>
            {(["standard", "simple"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={mode === value} disabled={value === "simple" && !simpleAvailable}
                onClick={() => { setMode(value); setNotice(null); }}
                className={cn("min-h-11 border px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", mode === value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent")}>
                {value === "standard" ? "Standard · 5c" : "Simple · 1c"}
              </button>
            ))}
          </fieldset>
          {!simpleAvailable && <p className="text-xs text-muted-foreground">Simple mode is unavailable for this resident.</p>}
          <label htmlFor={`${id}-question`} className="block text-sm font-medium">Your question</label>
          <textarea id={`${id}-question`} value={question} onChange={(event) => { setQuestion(event.target.value); setNotice(null); }}
            disabled={unavailable || uncertain || !signedIn} maxLength={maxChars} rows={4} aria-describedby={`${id}-limits`}
            className="w-full min-w-0 resize-y border border-input bg-background p-3 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            placeholder={mode === "simple" ? "A short task: summarise, rewrite or extract…" : "What do you need help with?"} />
          <p id={`${id}-limits`} className="text-xs text-muted-foreground">{question.length} / {maxChars} characters · {mode === "simple" ? "Short answer, no tools." : "Bounded text answer."} Limits are also enforced by the server.</p>
          <Button disabled={!canAsk || uncertain} className="min-h-11 rounded-none" onClick={() => void ask()}>
            {busy === "ask" ? "Waiting for the resident…" : `Ask · ${euro(price)} from balance`}
          </Button>
          {signedIn && safeBalance < price && <p className="text-sm text-muted-foreground">Add credit to ask this question. No automatic top-up will occur.</p>}
          {uncertain && <div className="space-y-2 border border-chart-2/50 bg-chart-2/5 p-3">
            <p className="text-sm">A request is awaiting confirmation. Keep this question unchanged until its outcome is known.</p>
            <Button variant="outline" disabled={unavailable} className="min-h-11 rounded-none" onClick={() => void ask(true)}>Check / retry the same request</Button>
          </div>}
          {answer && <div className="space-y-2 border border-primary/30 bg-primary/5 p-3" aria-live="polite"><h4 className="font-mono text-xs uppercase tracking-wide">Resident answer</h4><p className="break-words whitespace-pre-wrap text-sm leading-relaxed">{answer}</p></div>}
        </div>
      ) : <p className="border-t border-border pt-3 text-sm text-muted-foreground">Choose an available resident to ask a prepaid question.</p>}

      {notice && <p role="status" className="break-words border-l-2 border-primary pl-3 text-sm leading-relaxed">{notice}</p>}
      {signedIn && onRefresh && <Button variant="outline" className="min-h-11 rounded-none" disabled={unavailable} onClick={onRefresh}>Refresh balance / payment status</Button>}
      <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">Anonymous, single-question HTTP 402 / MPP payments remain a separate option at the resident's published price (currently from €0.50). Public MCP tools cannot spend your private balance.</p>
    </section>
  );
}
