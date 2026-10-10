import { Shell } from "@/components/shelter/shell";
import { Button } from "@/components/ui/button";
import { href, useRoute } from "@/lib/router";
import { AdminPage } from "@/pages/admin-page";
import { HomePage } from "@/pages/home-page";
import { MachinePage, MePage, SponsorReturnPage } from "@/pages/me-page";
import { ResidentPage } from "@/pages/resident-page";
import { SurrenderPage } from "@/pages/surrender-page";
import { usePageSeo } from "@/hooks/use-page-seo";
import { PlaygroundPage } from "@/pages/playground-page";

function App() {
  usePageSeo();
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
