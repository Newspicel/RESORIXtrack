import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    coverage: { provider: "v8", include: ["src/server/**"], thresholds: { lines: 80 } },
  },
})
