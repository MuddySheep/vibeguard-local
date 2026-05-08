import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
  // libpg-query is a peer dependency — never bundle it. Consumers
  // install it alongside @vibeguard-dev/local.
  external: ["libpg-query"],
  // Server-side Node only for the initial release. Document this in
  // README; consider browser builds in 2.x if there's pull.
  platform: "node",
  // Shim `import.meta.url` (and `__dirname` / `__filename`) across
  // ESM and CJS outputs. Without this, tsup compiles
  // `createRequire(import.meta.url)` in src/parser.ts to
  // `createRequire(undefined)` in the CJS bundle, which makes
  // `require('libpg-query')` throw — so CJS consumers see a spurious
  // "peer dependency missing" error. Discovered via post-publish
  // smoke against the npm registry.
  shims: true,
});
