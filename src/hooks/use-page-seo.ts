import { useEffect } from "react";
import { useRoute } from "@/lib/router";

/** Keep SPA navigation metadata aligned with the same public server-side source. */
export function usePageSeo() {
  const route = useRoute();
  const slug = "slug" in route ? route.slug : "";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/shelter/metadata?path=${encodeURIComponent(location.pathname)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(f => {
        if (!f || controller.signal.aborted) return;
        document.title = f.title;
        const set = (selector: string, name: string, content: string, property = false) => {
          const node = document.querySelector<HTMLMetaElement>(selector) ?? document.createElement("meta");
          node.setAttribute(property ? "property" : "name", name);
          node.content = content;
          if (!node.parentNode) document.head.append(node);
        };
        set('meta[name="description"]', "description", f.description);
        set('meta[name="robots"]', "robots", f.status === 200 ? "index, follow" : "noindex, nofollow");
        set('meta[property="og:title"]', "og:title", f.title, true);
        set('meta[property="og:description"]', "og:description", f.description, true);
        set('meta[property="og:url"]', "og:url", f.canonical, true);
        const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement("link");
        link.rel = "canonical"; link.href = f.canonical;
        if (!link.parentNode) document.head.append(link);
        document.querySelectorAll('script[type="application/ld+json"]').forEach(n => n.remove());
        if (f.jsonLd) {
          const script = document.createElement("script"); script.type = "application/ld+json";
          script.textContent = JSON.stringify(f.jsonLd); document.head.append(script);
        }
      }).catch(() => { /* preserve last valid metadata on transient network failure */ });
    return () => controller.abort();
  }, [route.name, slug]);
}
