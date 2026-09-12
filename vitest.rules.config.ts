/**
 * Security rules test config.
 *
 * A separate config rather than a CLI override: these tests need a live
 * Firestore emulator, and mixing them into the default run would make `npm test`
 * fail for anyone without one.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/rules-tests/**/*.test.ts'],
    // Rules tests share one emulator instance and clear it between cases, so
    // they must not run in parallel against each other.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
