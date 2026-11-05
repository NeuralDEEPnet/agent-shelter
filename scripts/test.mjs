#!/usr/bin/env node
/**
 * `npm test` — runs every offline proof suite against a throwaway SQLite
 * database. No network, no Stripe, no model: everything external is faked
 * inside the suites themselves. Works in a public clone after
 * `npm run install:public`, and in the Adaptive workspace.
 *
 *   npm test                      # all suites
 *   npm test -- scripts/verify-shelter.test.ts   # one suite
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, "node_modules", ".cache", "agent-shelter-test");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

// Defaults only — anything already in the environment wins, so the workspace
// can point the suites at its own .env.development.
const defaults = {
  PORT: "3999",
  API_KEY: "local-test-key",
  DB_FILE_NAME: `file:${join(scratch, "shelter.db")}`,
  GUEST_SERVICES_URL: "http://127.0.0.1:1/",
  QUEUE_DB_FILE_NAME: join(scratch, "queue.db"),
  ERRORS_DB_FILE_NAME: join(scratch, "errors.db"),
  VITE_APP_ID: "agent-shelter-test",
  VITE_BASE_URL: "http://127.0.0.1:3999/",
  VITE_ROOT_URL: "http://127.0.0.1:3999/",
  VITE_REALTIME_DOMAIN: "127.0.0.1",
  VITE_BOX_ID: "local",
  VITE_NODE_ENV: "development",
  SHELTER_CLEAN_APPROVAL: "false",
};
const env = { ...defaults, ...process.env };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
  return r.status ?? 1;
}

if (!existsSync(join(root, "generated", "client.ts"))) {
  console.log("[test] generating the Prisma client");
  if (run("npx", ["prisma", "generate"]) !== 0) process.exit(1);
}
console.log("[test] applying migrations to a throwaway database");
if (run("npx", ["prisma", "migrate", "deploy"]) !== 0) process.exit(1);

const explicit = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const suites = explicit.length
  ? explicit
  : [
      ...readdirSync(join(root, "scripts")).filter((f) => /\.test\.ts$/.test(f)).map((f) => join("scripts", f)),
      ...["mpp-kit", "model-router"].flatMap((p) => {
        const dir = join(root, "packages", p, "test");
        return existsSync(dir) ? readdirSync(dir).filter((f) => /\.test\.ts$/.test(f)).map((f) => join("packages", p, "test", f)) : [];
      }),
    ].sort();

console.log(`[test] ${suites.length} suite(s):\n  ${suites.join("\n  ")}`);
const tsx = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const status = run(tsx, ["--test", ...suites]);
process.exit(status);
