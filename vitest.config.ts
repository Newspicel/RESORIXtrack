import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    // no coverage gate: `vitest run --coverage` needs @vitest/coverage-v8, which is not installed
  },
})
