import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // The shared MPP kit is source-only (a `file:` symlink to
  // /home/computer/shared/mpp-kit exporting .ts); inline it into the bundle.
  ssr: { noExternal: ["@neuraldeep/mpp-kit", "@neuraldeep/model-router"] },
  build: {
    ssr: true,
    outDir: "dist/api",
    emptyOutDir: false,
    target: "node22",
    rollupOptions: {
      input: "src/api/server.ts",
      output: {
        entryFileNames: "server.js",
        format: "esm",
      },
    },
  },
});
