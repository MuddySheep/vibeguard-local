import { defineConfig } from 'vitest/config';

// Vitest configuration for eslint-plugin-vibeguard.
//
// Tests live in tests/. The plugin imports from the workspace SDK
// via `@vibeguard-dev/local`; tests do the same and rely on pnpm's
// workspace symlink to resolve to the live SDK source rather than
// a stale dist.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    typecheck: { enabled: false },
  },
});
