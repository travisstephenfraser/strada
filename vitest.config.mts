import { defineConfig } from "vitest/config";

/**
 * Hermetic tests only — no network, no database, no credentials. `npm test` must be
 * runnable by a grader who has cloned the repo and has no Neon project of their own.
 *
 * The two-account RLS proof lives in vitest.rls.config.ts and runs under `npm run
 * test:rls`, because it needs real accounts. It is deliberately NOT part of this
 * config: a security test that silently skips is worse than no test, since its skip
 * prints as a pass.
 */
export default defineConfig({
  test: {
    include: [
      "packages/shared/tests/**/*.test.ts",
      "apps/api/tests/**/*.test.ts",
      "apps/sync/tests/**/*.test.ts",
    ],
    environment: "node",
  },
});
