#!/usr/bin/env node
/**
 * Public install — lets anyone outside the Adaptive workspace run
 * `npm run check` and `npm test` on this repository.
 *
 * The live app depends on three private packages (`@adaptive-ai/sdk` and two
 * sibling-app SDKs) that only resolve inside the Adaptive workspace. Here they
 * are replaced by the small, typed stubs in ./stubs, which implement exactly
 * the surface this codebase imports (auth, queue, Hono middleware, Composio
 * calls, the two playground bridges). Nothing in ./stubs is ever shipped: the
 * production build runs in the workspace, where the real packages exist and
 * this script simply defers to `npm install`.
 *
 *   node scripts/install-public.mjs            # public clone / CI
 *   node scripts/install-public.mjs --force    # ignore ADAPTIVE_AI_REGISTRY
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const STUB_VERSION = "0.0.0-local-stub";

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

if (process.env.ADAPTIVE_AI_REGISTRY && !force) {
  console.log("[install-public] ADAPTIVE_AI_REGISTRY is set — assuming the Adaptive workspace; running plain `npm install`.");
  run("npm", ["install"]);
  process.exit(0);
}

const pkgPath = join(root, "package.json");
const lockPath = join(root, "package-lock.json");
const pkgOriginal = readFileSync(pkgPath, "utf8");
const lockOriginal = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : null;
const pkg = JSON.parse(pkgOriginal);
const stripped = Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith("@adaptive-ai/"));
for (const name of stripped) delete pkg.dependencies[name];
// `prisma generate` runs explicitly below, after the stubs are in place.
delete pkg.scripts.postinstall;

console.log(`[install-public] installing public dependencies (temporarily dropping: ${stripped.join(", ") || "nothing"})`);
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
try {
  // The registry variable must parse as a URL even though no @adaptive-ai/* package is requested.
  run("npm", ["install", "--no-audit", "--no-fund"], { ADAPTIVE_AI_REGISTRY: "https://registry.npmjs.org/" });
} finally {
  writeFileSync(pkgPath, pkgOriginal);
  if (lockOriginal !== null) writeFileSync(lockPath, lockOriginal);
  else rmSync(lockPath, { force: true });
}

const stubsRoot = join(root, "stubs", "adaptive-ai");
const target = join(root, "node_modules", "@adaptive-ai");
mkdirSync(target, { recursive: true });
for (const name of ["sdk", "sketchmonkey-neuraldeepnet", "3dj-neuraldeepnet"]) {
  const src = join(stubsRoot, name);
  const dst = join(target, name);
  if (existsSync(join(dst, "package.json"))) {
    const installed = JSON.parse(readFileSync(join(dst, "package.json"), "utf8"));
    if (installed.version !== STUB_VERSION) {
      console.log(`[install-public] keeping real @adaptive-ai/${name}@${installed.version}`);
      continue;
    }
    rmSync(dst, { recursive: true, force: true });
  }
  cpSync(src, dst, { recursive: true });
  console.log(`[install-public] stubbed @adaptive-ai/${name}`);
}

run("npx", ["prisma", "generate"]);
console.log("\n[install-public] done. Next: `npm run check:types` and `npm test`.");
