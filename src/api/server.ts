import { Hono } from "hono";
import { deserialize, serialize } from "superjson";
import { serve } from "@hono/node-server";
import { honoMiddleware, initializeServerEnvironment } from "@adaptive-ai/sdk/server";
import { isJsonRpcRequest } from "typed-rpc/server";
import { env } from "@/lib/env";

const transcoder = { serialize, deserialize };

initializeServerEnvironment({
  baseUrl: env.VITE_BASE_URL,
  realtimeDomain: env.VITE_REALTIME_DOMAIN,
  guestServicesUrl: env.GUEST_SERVICES_URL,
  environment: env.VITE_NODE_ENV,
  apiKey: env.API_KEY,
  queueDbPath: env.QUEUE_DB_FILE_NAME,
  errorsDbPath: env.ERRORS_DB_FILE_NAME,
});

// Import these after initializing the environment
const { procedures, jobs } = await import("@/api");
const { queue } = await import("@/api/queue");
const { machineRoutes } = await import("@/api/machine");
const { machinePayments } = await import("@/api/mppClient");

const app = new Hono();

// Internet scanners POST GraphQL payloads at guessable paths. Anything under
// `/api/*` otherwise reaches the SDK's JSON-RPC handler, which answers
// "Invalid Request" AND records it in errors.db as if the app had crashed.
const SCANNER_PATHS = new Set(["/api/graphql", "/api/gql", "/api/graphiql", "/api/playground", "/api/v1/graphql", "/api/query"]);
app.all("/api/*", async (c, next) => {
  const pathname = new URL(c.req.url).pathname.replace(/\/+$/, "").toLowerCase();
  if (SCANNER_PATHS.has(pathname)) return c.text("Not found", 404);
  await next();
});

/**
 * Machine door (MPP hire, MCP server, surrender API, discovery) — mounted ABOVE
 * `honoMiddleware`: the SDK treats every POST under /api/* as JSON-RPC and would
 * log these plain-HTTP routes as malformed calls. Unconfigured MPP is a
 * deployment state, not an error — paid routes answer 503 problem+json.
 */
app.route(
  "/",
  machineRoutes({
    enqueueScreen: (residentId) => {
      queue.screenResident({ residentId });
    },
  }),
);
{
  const health = machinePayments().health();
  console.log(`[mpp] machine payments ${health.state}${health.mode ? ` (${health.mode}, live=${health.livemode})` : ""}: ${health.detail}`);
}

/**
 * Reject non-RPC or invalid `/api/*` traffic before the SDK RPC middleware sees it.
 *
 * The SDK middleware treats every POST under `/api/*` as JSON-RPC and logs any
 * mismatch (or unknown method) as an error in errors.db. MCP traffic (initialize,
 * tools/list, notifications/initialized), scanner payloads (GraphQL, queries),
 * and probe traffic must be intercepted and answered 404 here so they never
 * trigger false-positive "-32600 Invalid Request" or "-32601 Method not found" errors.
 */
function isValidProcedureCall(body: unknown): boolean {
  try {
    const decoded = deserialize(body as Parameters<typeof deserialize>[0]) ?? body;
    if (!isJsonRpcRequest(decoded)) return false;
    return typeof (procedures as Record<string, unknown>)[decoded.method] === "function";
  } catch {
    return false;
  }
}

const rpcGuard = async (c: { req: { method: string; text: () => Promise<string> }; text: (text: string, status?: number) => Response }, next: () => Promise<void>) => {
  if (c.req.method !== "POST") {
    return c.text("Not found", 404);
  }

  let raw: string;
  try {
    raw = await c.req.text();
  } catch {
    return c.text("Not found", 404);
  }

  if (raw.trim().length === 0) {
    return c.text("Not found", 404);
  }

  try {
    if (!isValidProcedureCall(JSON.parse(raw))) {
      return c.text("Not found", 404);
    }
  } catch {
    return c.text("Not found", 404);
  }

  return next();
};

app.use("/api", rpcGuard);
app.use("/api/*", rpcGuard);

app.use(honoMiddleware({ procedures, jobs, transcoder }));

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error?.code === "EPIPE") return;
    throw error;
  });
}

const apiPort = Number(env.PORT) + 1;

/**
 * Robust server listener with retry on EADDRINUSE and graceful shutdown.
 *
 * When nodemon restarts after a build or tsx detects changes, the outgoing
 * process may still momentarily hold the listening socket. Retrying a bounded
 * number of times avoids crashing with EADDRINUSE, and cleaning up on
 * SIGTERM/SIGINT frees the socket immediately for subsequent restarts.
 */
function startApiServer(attempt = 0) {
  const server = serve({ fetch: app.fetch, port: apiPort });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && attempt < 20) {
      server.close(() => {});
      setTimeout(() => startApiServer(attempt + 1), 250);
      return;
    }
    console.error(`[api] failed to listen on ${apiPort}:`, error);
    process.exitCode = 1;
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startApiServer();
