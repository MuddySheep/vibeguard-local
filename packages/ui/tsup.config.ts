import { defineConfig } from 'tsup';

// @vibeguard-dev/ui — ESM-only React component library.
//
// Why ESM-only: consumers are application bundlers (Vite, webpack,
// Rollup) which resolve ESM and tree-shake just fine. CJS adds
// duplicate output and an interop tax for no realistic consumer.
//
// React + react-dom are externalized as peer deps so consumers
// dedupe React with their own copy.
//
// CSS files (src/tokens.css, src/global.css) are exported via
// `exports['./tokens.css']` rather than bundled — Vite/webpack
// can pick them up directly and apply their own asset pipelines.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  platform: 'browser',
});
