// `vitest/config` rather than `vite` — it is what types the `test` block.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        /*
         * Split the libraries out from the app.
         *
         * Everything used to land in one file, so changing a label on the
         * dashboard invalidated React, the router and the whole Firebase SDK
         * along with it — a returning user re-downloaded all of it for a
         * one-line change. These barely change between deploys, so they get
         * their own long-lived files.
         *
         * `firebase` is the heavy one by a wide margin, and it is separate
         * from `react` deliberately: upgrading one should not evict the other
         * from a cache that is working perfectly well.
         */
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@firebase') || id.includes('/firebase/')) return 'firebase';
          if (id.includes('react-router')) return 'router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
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
