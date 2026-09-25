import { createLogger, defineConfig, HttpProxy } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { env } from "./src/lib/env";
import http from "http";
import { resolve } from "node:path";
import { shelterPrerender } from "./vite.prerender-plugin";

function proxyConfig(proxy: HttpProxy.ProxyServer) {
  proxy.on("error", function (err, _req, res) {
    if ("writeHead" in res) {
      (res as http.ServerResponse).writeHead(500, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          json: { error: "PROXY_ERROR", details: err.message },
        }),
      );
    }
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const pad3 = (n: number) => String(n).padStart(3, "0");

function formatTimestamp(d: Date) {
  return (
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad3(d.getMilliseconds())}`
  );
}

function timestampedLogger() {
  const base = createLogger("info", { allowClearScreen: false });
  const withTimestamp = (
    log: (msg: string, opts?: { timestamp?: boolean }) => void,
  ) => {
    return (msg: string, opts?: { timestamp?: boolean }) =>
      log(`[${formatTimestamp(new Date())}] ${msg}`, {
        ...opts,
        timestamp: false,
      });
  };

  return {
    ...base,
    info: withTimestamp(base.info.bind(base)),
    warn: withTimestamp(base.warn.bind(base)),
    warnOnce: withTimestamp(base.warnOnce.bind(base)),
    error: withTimestamp(base.error.bind(base)),
  };
}

export default ({ mode }: { mode: "development" | "production" }) => {
  console.log(`Started vite server in mode: ${mode}`);

  return defineConfig({
    // shelterPrerender: server-rendered fragments for non-JS fetchers (see vite.prerender-plugin.ts).
    plugins: [tsconfigPaths(), react(), tailwindcss(), shelterPrerender({ apiPort: Number(env.PORT) + 1 })],
    customLogger: timestampedLogger(),
    server: {
      port: Number(env.PORT),
      strictPort: true,
      allowedHosts: true,
      watch: {
        ignored: [
          "**/*.db",
          "**/*.db-journal",
          "**/*.db-shm",
          "**/*.db-wal",
          "**/*.log",
          resolve(import.meta.dirname, "data/**"),
          resolve(import.meta.dirname, "migrations/**"),
        ],
      },
      proxy: {
        "/_logger": {
          target: "http://localhost:" + (Number(env.PORT) + 1),
          changeOrigin: true,
          secure: false,
          configure: proxyConfig,
        },
        "/api/": {
          target: "http://localhost:" + (Number(env.PORT) + 1),
          changeOrigin: true,
          secure: false,
          configure: proxyConfig,
        },
      },
    },
    preview: {
      port: Number(env.PORT),
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/_logger": {
          target: "http://localhost:" + (Number(env.PORT) + 1),
          changeOrigin: true,
          secure: false,
          configure: proxyConfig,
        },
        "/api/": {
          target: "http://localhost:" + (Number(env.PORT) + 1),
          changeOrigin: true,
          secure: false,
          configure: proxyConfig,
        },
      },
    },
  });
};
