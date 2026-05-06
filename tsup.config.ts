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
});
