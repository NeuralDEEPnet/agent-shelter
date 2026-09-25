import { useEffect, useState } from "react";

/**
 * Tiny router. Routes live at real PATHS (`/r/:slug`, `/surrender`, `/admin`, …)
 * so crawlers and non-JS fetchers can request them and get the server-side
 * prerender. The old hash form (`#/r/:slug`) is still understood: on load it is
 * rewritten to the path form with `history.replaceState` so every link ever
 * published (cards, adoption packs, catalog `resume`) keeps working.
 *
 * Internal `<a href="/…">` clicks are intercepted once at the document level
 * and turned into `pushState` navigations — components just render plain anchors.
 */
export type Route =
  | { name: "home" }
  | { name: "resident"; slug: string }
  | { name: "surrender" }
  | { name: "admin" }
  | { name: "me" }
  | { name: "sponsor-return"; sessionId: string | null }
  | { name: "machine" }
  | { name: "not-found" };

/** Parse a path (with optional query) like `/r/minute` or `/sponsor/return?session_id=…`. */
export function parsePath(pathAndQuery: string): Route {
  const raw = pathAndQuery || "/";
  const [pathPart, query = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "r" && parts[1]) return { name: "resident", slug: decodeURIComponent(parts[1]) };
  if (parts[0] === "surrender") return { name: "surrender" };
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "me") return { name: "me" };
  if (parts[0] === "machine") return { name: "machine" };
  if (parts[0] === "sponsor" && parts[1] === "return") return { name: "sponsor-return", sessionId: params.get("session_id") };
  return { name: "not-found" };
}

/** Legacy: `#/r/minute` → the same Route. Kept for old links. */
export function parseHash(hash: string): Route {
  return parsePath(hash.replace(/^#/, "") || "/");
}

/** `#/r/minute?x=1` → `/r/minute?x=1`; anything else → null. */
export function hashToPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  const p = hash.slice(1);
  return p.startsWith("//") ? null : p; // never let `#//evil.host` become a protocol-relative URL
}

function currentLocation(): { path: string; route: Route } {
  const legacy = hashToPath(window.location.hash);
  if (legacy) {
    // Old hash link → canonical path form, without adding a history entry.
    window.history.replaceState(null, "", legacy);
    return { path: legacy, route: parsePath(legacy) };
  }
  const path = `${window.location.pathname}${window.location.search}`;
  return { path, route: parsePath(path) };
}

const NAV_EVENT = "shelter:navigate";

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentLocation().route);
  useEffect(() => {
    const onChange = () => {
      setRoute(currentLocation().route);
      window.scrollTo({ top: 0 });
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download") || a.dataset.native !== undefined) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname)) return; // machine door + files stay native
      if (parsePath(`${url.pathname}${url.search}`).name === "not-found") return;
      e.preventDefault();
      navigate(`${url.pathname}${url.search}`);
    };
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    window.addEventListener(NAV_EVENT, onChange);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener(NAV_EVENT, onChange);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return route;
}

/** Programmatic navigation. Accepts `/r/minute` or legacy `#/r/minute`. */
export function navigate(to: string) {
  const path = to.startsWith("#") ? (hashToPath(to) ?? "/") : to.startsWith("/") ? to : `/${to}`;
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Build an href for an in-app route. Plain path — crawlable, and intercepted on click. */
export const href = (to: string) => (to.startsWith("/") ? to : `/${to}`);
