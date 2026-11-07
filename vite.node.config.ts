import { defineConfig } from "vite"

/** Bundles the CLI and the worker into plain ESM for the container (dependencies stay in node_modules). */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    ssr: true,
    outDir: "dist/node",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      input: { cli: "src/cli/index.ts", worker: "src/worker/index.ts" },
      output: { format: "esm", entryFileNames: "[name].mjs" },
    },
  },
  ssr: { noExternal: [/^@\//] },
})
