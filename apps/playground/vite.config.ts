import react from '@vitejs/plugin-react';
import { defineConfig, Plugin } from 'vite';

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

// Plugin to handle libpg-query's CJS/UMD wasm file in ESM context.
// The file declares a global PgQueryModule var and uses module.exports,
// but doesn't have a proper ESM default export. We append one.
function libpgQueryWasmPlugin(): Plugin {
  const TARGET = 'libpg-query/wasm/libpg-query.js';
  return {
    name: 'libpg-query-wasm-esm',
    transform(code, id) {
      if (id.includes(TARGET) || id.endsWith('libpg-query.js')) {
        // Append ESM default export that re-exports the UMD global
        return {
          code: code + '\nexport default PgQueryModule;\nexport { PgQueryModule };\n',
          map: null,
        };
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), libpgQueryWasmPlugin()],
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
    port: 5000,
    host: '0.0.0.0',
    strictPort: true,
    open: false,
    allowedHosts: true,
  },
});
