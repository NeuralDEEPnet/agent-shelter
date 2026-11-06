#!/usr/bin/env node
/**
 * `npm run dev:public` — run the API locally from a public clone, no Adaptive
 * workspace needed. Uses the same env defaults as `npm test` (a throwaway
 * SQLite database under node_modules/.cache) and the stubs from
 * `npm run install:public`, so sign-in, the job queue, Stripe and the model
 * are NOT available — but everything an agent touches is:
 *
 *   POST /api/mcp          MCP server (initialize, tools/list, tools/call …)
 *   GET  /api/mpp/catalog  catalog, /api/mpp/openapi.json, /api/shelter/llms.txt
 *   POST /api/shelter/surrender   intake (static gate; screening job is a no-op here)
 *   POST /api/mpp/ask/:slug       free ask (answers 502 "no model" until OPENROUTER_OPENCODE_BASE_URL is set)
 *   POST /api/mpp/hire/:slug      HTTP 402 route (503 until Stripe keys are set)
 *
 * Set DB_FILE_NAME to keep a database between runs, PORT to change the port
 * (the API listens on PORT+1, like the workspace).
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, "node_modules", ".cache", "agent-shelter-dev");
mkdirSync(scratch, { recursive: true });

const port = process.env.PORT ?? "3999";
const defaults = {
  PORT: port,
  API_KEY: "local-dev-key",
  DB_FILE_NAME: `file:${join(scratch, "shelter.db")}`,
  GUEST_SERVICES_URL: "http://127.0.0.1:1/",
  QUEUE_DB_FILE_NAME: join(scratch, "queue.db"),
  ERRORS_DB_FILE_NAME: join(scratch, "errors.db"),
  VITE_APP_ID: "agent-shelter-dev",
  VITE_BASE_URL: `http://127.0.0.1:${port}/`,
  VITE_ROOT_URL: `http://127.0.0.1:${port}/`,
  VITE_REALTIME_DOMAIN: "127.0.0.1",
  VITE_BOX_ID: "local",
  VITE_NODE_ENV: "development",
};
const env = { ...defaults, ...process.env };

if (!existsSync(join(root, "generated", "client.ts"))) {
  const gen = spawnSync("npx", ["prisma", "generate"], { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
  if (gen.status !== 0) process.exit(gen.status ?? 1);
}
const mig = spawnSync("npx", ["prisma", "migrate", "deploy"], { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
if (mig.status !== 0) process.exit(mig.status ?? 1);

const apiPort = Number(port) + 1;
console.log(`\n[dev:public] API on http://127.0.0.1:${apiPort}  (MCP: POST /api/mcp · catalog: GET /api/mpp/catalog)`);
console.log(`[dev:public] database: ${env.DB_FILE_NAME}\n`);
const tsx = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const child = spawn(tsx, ["src/api/server.ts"], { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
