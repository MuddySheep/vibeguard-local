import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// VibeGuard playground — Vite config.
//
// base: relative-path so the build works under any sub-path (e.g.
// muddysheep.github.io/vibeguard-local/). Local dev still serves
// from /.
//
// optimizeDeps: pre-bundle libpg-query so its WASM loader resolves
// cleanly in dev mode. The .wasm file is fetched at runtime from
// the same origin via the URL set up by the libpg-query loader.
//
// assetsInclude: tell Vite to treat .wasm as static assets (it
// already does, but being explicit prevents accidental bundling).
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    exclude: ['libpg-query'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500, // libpg-query WASM bundle is ~1MB+
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
});
