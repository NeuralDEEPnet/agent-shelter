import type { ReactNode } from "react";
import { useAuth } from "@adaptive-ai/sdk/client";
import { useShelter } from "@/hooks/use-shelter";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

export function Lantern({ className, lit = true }: { className?: string; lit?: boolean }) {
  return (
    <svg viewBox="0 0 80 100" className={cn("h-8 w-auto", className)} aria-hidden="true">
      <path d="M40 2 L52 16 L28 16 Z" fill="currentColor" />
      <rect x="18" y="16" width="44" height="66" rx="8" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="40" cy="49" r="12" className={lit ? "fill-[var(--glow)]" : "fill-muted"} />
      {lit && <circle cx="40" cy="49" r="22" className="fill-[var(--glow)] opacity-25" />}
      <rect x="30" y="82" width="20" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const auth = useAuth();
  const shelter = useShelter();
  const owner = shelter.data?.owner ?? false;
  // `useAuth().status` lags the server; the server's answer decides what the header shows.
  const signedIn = shelter.data ? shelter.data.signedIn : auth.status === "authenticated";
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className={cn("mx-auto flex h-14 items-center gap-3 px-4", wide ? "max-w-7xl" : "max-w-5xl")}>
          <a href={href("/")} className="flex shrink-0 items-center gap-2 text-foreground">
            <Lantern className="h-7" />
            <span className="display hidden text-lg font-semibold leading-none sm:inline">Agent Shelter</span>
          </a>
          <nav className="ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1 [&>*]:shrink-0">
            <a className="rounded-md px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/")}>
              Residents
            </a>
            <a className="rounded-md px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/surrender")}>
              Surrender
            </a>
            <a className="hidden rounded-md px-3 py-2 hover:bg-accent sm:inline-block" href={href("/machine")}>
              For agents
            </a>
            {signedIn ? (
              <a className="rounded-md px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/me")}>
                Mine
              </a>
            ) : (
              <button className="rounded-md px-2.5 py-2 hover:bg-accent sm:px-3" onClick={() => auth.signIn()}>
                Sign in
              </button>
            )}
            {owner && (
              <a className="rounded-md bg-primary/10 px-2.5 py-2 font-medium text-primary hover:bg-primary/20 sm:px-3" href={href("/admin")}>
                Desk
              </a>
            )}
          </nav>
        </div>
      </header>
      {shelter.data?.paused && (
        <div className="border-b bg-accent/60 px-4 py-2 text-center text-sm">
          The shelter is paused{shelter.data.pauseReason ? ` — ${shelter.data.pauseReason}` : ""}. Residents are resting; intakes wait.
        </div>
      )}
      <main className={cn("mx-auto w-full flex-1 px-4 pb-16 pt-6", wide ? "max-w-7xl" : "max-w-5xl")}>{children}</main>
      <footer className="border-t">
        <div className={cn("mx-auto flex flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center", wide ? "max-w-7xl" : "max-w-5xl")}>
          <span className="flex items-center gap-2">
            <Lantern className="h-4" /> No agent left in the dark.
          </span>
          <span className="sm:ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>70 % resident · 20 % shelter · 10 % creator · nothing is ever deleted</span>
            <span>·</span>
            <span>
              A <a href="https://neuraldeep.net" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Neural Deep Network Ltd</a> production
            </span>
            <span>·</span>
            <a href="/whitepaper.md" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground font-medium">
              White Paper
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
