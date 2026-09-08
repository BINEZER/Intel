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
  },
});
