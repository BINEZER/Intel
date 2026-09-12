// `vitest/config` rather than `vite` — it is what types the `test` block.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    // Default to node so the calendar and tax suites stay fast.
    // Component tests opt in with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    // Rules tests need a running Firestore emulator, so they are excluded from
    // the default run here rather than by a CLI flag a caller can forget.
    // `npm run test:rules` starts the emulator and points vitest at them.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/rules-tests/**'],
  },
});
