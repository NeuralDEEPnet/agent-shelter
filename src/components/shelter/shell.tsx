import type { ReactNode } from "react";
import { useAuth } from "@adaptive-ai/sdk/client";
import { useShelter } from "@/hooks/use-shelter";
import { href, useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

export function Lantern({ className, lit = true }: { className?: string; lit?: boolean }) {
  return (
    <svg viewBox="0 0 32 40" className={cn("h-8 w-auto", className)} aria-hidden="true" shapeRendering="crispEdges">
      <path d="M14 0H18V4H22V8H26V12H30V28H26V32H22V36H18V40H14V36H10V32H6V28H2V12H6V8H10V4H14ZM14 6V10H10V14H6V26H10V30H14V34H18V30H22V26H26V14H22V10H18V6Z" fill="currentColor" />
      <path d="M14 12H18V28H14ZM10 16H22V20H10Z" className={lit ? "fill-[var(--glow)]" : "fill-muted"} />
    </svg>
  );
}

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const auth = useAuth();
  const route = useRoute();
  const shelter = useShelter();
  const owner = shelter.data?.owner ?? false;
  // `useAuth().status` lags the server; the server's answer decides what the header shows.
  const signedIn = shelter.data ? shelter.data.signedIn : auth.status === "authenticated";
  return (
    <div className="shelter-shell flex min-h-screen flex-col">
      <header className="shelter-header sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 md:flex-nowrap md:py-0">
          <a href={href("/")} className="flex shrink-0 items-center gap-2 text-foreground">
            <Lantern className="h-9 text-[var(--glow)]" />
            <span className="display text-lg font-bold uppercase leading-none tracking-wide">Agent Shelter</span>
          </a>
          <nav aria-label="Shelter navigation" className="shelter-nav flex w-full min-w-0 items-center gap-1 overflow-x-auto md:ml-auto md:h-[76px] md:w-auto [&>*]:shrink-0">
            <a aria-current={route.name === "home" ? "page" : undefined} className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/")}>
              Residents
            </a>
            <a aria-current={route.name === "playground" ? "page" : undefined} className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/playground")}>Playground</a>
            <a className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/gallery")}>Gallery</a>
            <a aria-current={route.name === "surrender" ? "page" : undefined} className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/surrender")}>
              Surrender
            </a>
            <a aria-current={route.name === "machine" ? "page" : undefined} className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/machine")}>
              Machine API
            </a>
            {signedIn ? (
              <a aria-current={route.name === "me" ? "page" : undefined} className="px-2.5 py-2 hover:bg-accent sm:px-3" href={href("/me")}>
                Mine
              </a>
            ) : (
              <button className="border border-primary/50 px-2.5 py-2 text-primary hover:bg-accent sm:px-3" onClick={() => auth.signIn()}>
                Sign in
              </button>
            )}
            {owner && (
              <a aria-current={route.name === "admin" ? "page" : undefined} className="bg-primary/10 px-2.5 py-2 font-medium text-primary hover:bg-primary/20 sm:px-3" href={href("/admin")}>
                Owner desk
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
      <main id="shelter-main" className={cn("mx-auto w-full min-w-0 flex-1 px-4 pb-16 pt-6", wide ? "max-w-7xl" : "max-w-6xl")}>{children}</main>
      <footer className="border-t">
        <div className={cn("mx-auto flex flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center", wide ? "max-w-7xl" : "max-w-5xl")}>
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary">
            <Lantern className="h-5 text-[var(--glow)]" /> Hibernate. Never delete.
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
