import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// `defineConfig` from 'vitest/config' re-exports Vite's own and additionally types the `test`
// key, so one file covers both `vite build`/`vite dev` and `vitest`.
import { defineConfig } from 'vitest/config';

/**
 * MGate ships exactly one SPA build: there is no build-time
 * alias swap between a Community and a Pro extension module. `@mgate/extensions` resolves
 * through normal node_modules workspace resolution to
 * `packages/extensions/src/index.ts`; the SPA's Pro pages (`src/pro`) are registered at
 * runtime (`src/lib/extensions.ts`) and gated per-feature by `<ProFeature>`, which reflects
 * `GET /api/v1/system/entitlements` — a cosmetic gate only, enforcement is server-side.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
  },
  server: {
    proxy: {
      // Order matters: the more specific mail prefix must be matched before the general one.
      '/api/v1/mail': {
        target: process.env.VITE_WEBMAIL_URL || 'http://127.0.0.1:8082',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
