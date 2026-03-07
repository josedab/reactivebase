import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Use 'forks' pool to avoid Node.js 24 worker_threads EventEmitter
    // compatibility issue with tinypool during dynamic imports
    pool: "forks",
    // Dynamic import of @reactivebase/server is slow due to large bundle
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
})
