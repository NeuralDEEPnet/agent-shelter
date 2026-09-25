import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const localBinDir = path.join(rootDir, 'node_modules', '.bin');

process.chdir(rootDir);

const envFilePath = path.join(rootDir, '.env.development');
try {
  process.loadEnvFile(envFilePath);
} catch (error) {
  console.error(
    `Failed to load ${envFilePath}: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

const childEnv = {
  ...process.env,
  PATH: `${localBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
};

const args = new Set(process.argv.slice(2));
const knownArgs = new Set(['--stop', '--migrate', '--restart', '--force']);
const unknownArgs = [...args].filter((arg) => !knownArgs.has(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  process.exit(1);
}
const apiLogPath = path.join(rootDir, 'api-dev.log');
const viteLogPath = path.join(rootDir, 'vite-dev.log');
const markerPath = path.join(
  rootDir,
  'node_modules',
  '.cache',
  'adaptive-ai',
  'prisma-migrate-dev.sha256',
);

const children = new Set();
let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

if (args.has('--stop')) {
  freeDevPorts();
  process.exit(0);
}

if (args.has('--migrate')) {
  await runMigrations({ force: args.has('--force') });
  process.exit(0);
}

// --restart needs no dedicated branch: a normal boot already frees the dev
// ports before starting, which is exactly a stop + start.
freeDevPorts();

const vite = spawnLoggedProcess({
  name: 'vite',
  command: 'vite',
  args: ['--host', '0.0.0.0'],
  logPath: viteLogPath,
});

try {
  await runMigrations({ force: args.has('--force') });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
  await waitForever();
}

spawnLoggedProcess({
  name: 'api',
  command: 'tsx',
  args: ['watch', '--include', 'src/api/procedures.ts', 'src/api/server.ts'],
  logPath: apiLogPath,
});

await waitForExit(vite);

async function runMigrations({ force = false } = {}) {
  if (!force && (await canSkipMigrations())) {
    console.log(
      'Prisma schema and migrations unchanged; skipping migrate dev.',
    );
    return;
  }

  await runCommand({
    name: 'prisma migrate dev',
    command: 'prisma',
    args: ['migrate', 'dev', '--name', 'auto'],
    logPath: apiLogPath,
  });

  await writeMigrationMarker();
}

async function canSkipMigrations() {
  const [currentHash, previousHash, dbReady, clientReady] = await Promise.all([
    getMigrationHash(),
    readMarker(),
    databaseExists(),
    generatedClientExists(),
  ]);

  return currentHash === previousHash && dbReady && clientReady;
}

async function writeMigrationMarker() {
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${await getMigrationHash()}\n`);
}

async function readMarker() {
  try {
    return (await readFile(markerPath, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function getMigrationHash() {
  const hash = createHash('sha256');
  await hashFile(hash, path.join(rootDir, 'schema.prisma'), 'schema.prisma');
  await hashDirectory(hash, path.join(rootDir, 'migrations'), 'migrations');
  return hash.digest('hex');
}

async function hashDirectory(hash, directory, relativeDirectory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      hash.update(`${relativeDirectory}\0missing\0`);
      return;
    }

    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await hashDirectory(hash, fullPath, relativePath);
    } else if (entry.isFile()) {
      await hashFile(hash, fullPath, relativePath);
    }
  }
}

async function hashFile(hash, filePath, relativePath) {
  hash.update(`${relativePath}\0`);
  hash.update(await readFile(filePath));
  hash.update('\0');
}

async function databaseExists() {
  const dbPath = sqliteFilePath(process.env.DB_FILE_NAME);

  if (!dbPath) {
    return false;
  }

  try {
    return (await stat(dbPath)).isFile();
  } catch {
    return false;
  }
}

async function generatedClientExists() {
  const candidates = [
    path.join(rootDir, 'generated', 'client.ts'),
    path.join(rootDir, 'generated', 'client.js'),
    path.join(rootDir, 'generated', 'client'),
  ];

  for (const candidate of candidates) {
    try {
      const result = await stat(candidate);

      if (result.isFile() || result.isDirectory()) {
        return true;
      }
    } catch {
      // Keep looking for another generated client shape.
    }
  }

  return false;
}

function sqliteFilePath(url) {
  if (!url?.startsWith('file:')) {
    return null;
  }

  const withoutProtocol = url.slice('file:'.length);
  const [filePath] = withoutProtocol.split('?');

  if (!filePath) {
    return null;
  }

  return path.resolve(rootDir, decodeURIComponent(filePath));
}

function freeDevPorts() {
  const basePort = Number(process.env.PORT);

  if (!Number.isInteger(basePort)) {
    throw new Error('PORT must be set in .env.development before running dev.');
  }

  for (const port of [basePort, basePort + 1]) {
    freePort(port);
  }
}

function freePort(port) {
  const result = spawnSync('lsof', ['-ti', `:${port}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.error?.code === 'ENOENT') {
    console.warn('Could not free dev ports because lsof is not installed.');
    return;
  }

  const pids = result.stdout
    .split(/\s+/)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process may already be gone by the time we try to kill it.
    }
  }
}

function spawnLoggedProcess({
  name,
  command,
  args,
  logPath,
  exitIsFatal = true,
}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.add(child);

  const log = createWriteStream(logPath, { flags: 'a' });
  log.on('error', (error) => {
    console.error(`Failed writing ${name} log: ${error.message}`);
  });
  let logClosed = false;
  const closeLog = () => {
    if (!logClosed) {
      logClosed = true;
      log.end();
    }
  };

  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  child.once('close', (code, signal) => {
    children.delete(child);
    closeLog();

    if (exitIsFatal && !shuttingDown) {
      const exitCode = code ?? (signal ? 1 : 0);
      console.error(`${name} exited${signal ? ` with ${signal}` : ''}.`);
      shutdown(exitCode);
    }
  });

  child.once('error', (error) => {
    children.delete(child);
    closeLog();

    if (exitIsFatal && !shuttingDown) {
      console.error(`Failed to start ${name}: ${error.message}`);
      shutdown(1);
    }
  });

  return child;
}

function runCommand({ name, command, args, logPath }) {
  return new Promise((resolve, reject) => {
    const child = spawnLoggedProcess({
      name,
      command,
      args,
      logPath,
      exitIsFatal: false,
    });

    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${name} failed${signal ? ` with ${signal}` : ` with code ${code}`}.`,
          ),
        );
      }
    });

    child.once('error', (error) => {
      reject(new Error(`Failed to start ${name}: ${error.message}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('close', () => resolve());
  });
}

function waitForever() {
  return new Promise(() => {});
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }

    process.exit(exitCode);
  }, 500);
}
