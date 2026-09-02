import { defineConfig } from "vitest/config";

/**
 * The two-account privacy proof. Separate from `npm test` on purpose.
 *
 * This suite needs two real accounts and a reachable Data API, so it cannot be part of
 * the hermetic suite a grader runs straight after cloning. Keeping it separate is what
 * lets it FAIL when its configuration is missing instead of skipping: a security test
 * that skips prints as a pass, and "14 passed" would then be evidence of nothing.
 */
export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    // Real network round trips against a live database.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These tests share one table and assert on unfiltered reads, so they must not
    // interleave with each other.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
