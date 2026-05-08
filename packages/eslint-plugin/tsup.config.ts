import { defineConfig } from 'tsup';

// ESM-only build for eslint-plugin-vibeguard.
//
// Why no CJS:
//   The plugin entry uses top-level `await init()` to bootstrap the
//   libpg-query WASM parser. Top-level await is only supported in
//   ESM modules; emitting a CJS bundle would either fail at load
//   time or silently skip the init.
//
//   ESLint 9 (our peer-dep floor) defaults to flat config in ESM
//   modules. The legacy .eslintrc / CJS path is deferred to a
//   later release per the V1 spec.

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  // Peer deps — never bundle.
  external: ['libpg-query', 'eslint', '@vibeguard-dev/local'],
  platform: 'node',
  shims: true,
});
