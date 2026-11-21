import { defineConfig } from 'vitest/config';

// Dev: Vite on 5173 proxies /api and /ws to the Node server on 3001.
// Prod: the Express server serves dist/ and the API on one port.
const API_PORT = process.env.PORT || '3001';

// The /glasses page must run on the Android 9 WebView (Chromium ~69, factory version unknown).
// Vite 8 defaults to Chrome 111. Lower the JS and CSS targets so ?. and ?? are lowered.
// See docs/COMPAT-PERF.md and scripts/check-legacy.mjs.
const LEGACY_TARGET = 'chrome69';

export default defineConfig({
  build: {
    target: LEGACY_TARGET,
    cssTarget: LEGACY_TARGET,
    // dist/.vite/manifest.json lets scripts/check-budgets.mjs find the /glasses entry graph.
    manifest: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      // Set a little under the numbers achieved on 2026-11-21 (all 91.4 / 85.2, server 95.6 / 92.6,
      // shared 100 / 95.7, hud-kit 93.7 / 86.4) so a regression fails `npm run coverage`.
      thresholds: {
        statements: 89, branches: 82, functions: 84, lines: 92,
        'server/**': { statements: 93, branches: 89 },
        'shared/**': { statements: 98, branches: 92 },
        'src/hud-kit/**': { statements: 91, branches: 83 },
      },
      include: ['server/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}', 'src/hud-kit/**/*.{ts,tsx}', 'src/apps/**/*.{ts,tsx}', 'src/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'src/main.tsx', 'scripts/**', 'server/index.ts', 'src/polyfills.ts' /* tested in a vm context, v8 cannot see it */],
    },
  },
});
