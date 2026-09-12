import { defineConfig } from "vitest/config";

// Auth-flow tests talk to the real Supabase project over the network, so they
// run in a Node environment (no jsdom) with generous timeouts and no
// parallelism between files (they share one backend and create/delete users).
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
