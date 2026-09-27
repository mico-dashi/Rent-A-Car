import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration files share one database; run them sequentially.
    fileParallelism: false,
  },
});
