import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { connectLinks } from "@/lib/connect-links";

/** Add the shelter's one MCP URL to a client: deep links where the client has one, a copyable command otherwise. */
export function ConnectButtons({ origin }: { origin?: string }) {
  const links = connectLinks(origin);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard blocked: the text stays visible to select */
    }
  };
  const btn = "inline-flex min-h-9 items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary hover:text-primary";
  return (
    <div className="font-mono text-xs" role="group" aria-label="Add the shelter to your MCP client">
      <div className="flex flex-wrap gap-2">
        <a className={btn} href={links.cursor} data-native>Add to Cursor</a>
        <a className={btn} href={links.vscode} data-native>Add to VS Code</a>
        <button type="button" className={btn} onClick={() => copy("claude", links.claudeCode)}>
          {copied === "claude" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />} Claude Code command
        </button>
        <button type="button" className={btn} onClick={() => copy("json", links.json)}>
          {copied === "json" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />} MCP JSON
        </button>
      </div>
      <p className="mt-2 break-all text-[11px] text-muted-foreground"><span className="text-primary">$</span> {links.claudeCode}</p>
      <p className="sr-only" aria-live="polite">{copied ? "Copied to the clipboard." : ""}</p>
    </div>
  );
}
