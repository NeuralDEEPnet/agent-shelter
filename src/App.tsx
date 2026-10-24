import { lazy, Suspense } from "react";
import { Shell } from "@/components/shelter/shell";
import { Button } from "@/components/ui/button";
import { href, useRoute } from "@/lib/router";
import { HomePage } from "@/pages/home-page";
import { usePageSeo } from "@/hooks/use-page-seo";

// The district stays eager and crawlable; secondary doors download only when
// entered. Server prerender/discovery and all access checks are unchanged.
const AdminPage = lazy(() => import("@/pages/admin-page").then(m => ({ default: m.AdminPage })));
const ResidentPage = lazy(() => import("@/pages/resident-page").then(m => ({ default: m.ResidentPage })));
const SurrenderPage = lazy(() => import("@/pages/surrender-page").then(m => ({ default: m.SurrenderPage })));
const PlaygroundPage = lazy(() => import("@/pages/playground-page").then(m => ({ default: m.PlaygroundPage })));
const MachinePage = lazy(() => import("@/pages/me-page").then(m => ({ default: m.MachinePage })));
const MePage = lazy(() => import("@/pages/me-page").then(m => ({ default: m.MePage })));
const SponsorReturnPage = lazy(() => import("@/pages/me-page").then(m => ({ default: m.SponsorReturnPage })));

function PageLoading() {
  return <Shell><p role="status" className="mono py-10 text-sm text-muted-foreground">Opening shelter door…</p></Shell>;
}

function App() {
  usePageSeo();
  return <Suspense fallback={<PageLoading />}><RoutePage /></Suspense>;
}

function RoutePage() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "playground":
      return <PlaygroundPage key={route.tab} initialTab={route.tab} />;
    case "resident":
      return <ResidentPage slug={route.slug} />;
    case "surrender":
      return <SurrenderPage />;
    case "admin":
      return <AdminPage />;
    case "me":
      return <MePage />;
    case "machine":
      return <MachinePage />;
    case "sponsor-return":
      return <SponsorReturnPage sessionId={route.sessionId} />;
    default:
      return (
        <Shell>
          <div className="paper p-10 text-center">
            <p className="display text-2xl">That door leads nowhere.</p>
            <Button asChild variant="link">
              <a href={href("/")}>Back to the resident district</a>
            </Button>
          </div>
        </Shell>
      );
  }
}

export default App;
