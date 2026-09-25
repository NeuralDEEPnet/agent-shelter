import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App.tsx";
import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { initializeClientEnvironment } from "@adaptive-ai/sdk/client";
import { RootErrorBoundary } from "@/components/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";

initializeClientEnvironment({
  appId: import.meta.env.VITE_APP_ID,
  rootUrl: import.meta.env.VITE_ROOT_URL,
  baseUrl: import.meta.env.VITE_BASE_URL,
  isTesting: !import.meta.env.PROD,
  realtimeDomain: import.meta.env.VITE_REALTIME_DOMAIN,
  boxId: import.meta.env.VITE_BOX_ID,
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          <App />
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
