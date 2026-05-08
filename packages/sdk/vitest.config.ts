import { defineConfig } from 'vitest/config';

// Vitest configuration for @vibeguard-dev/local.
//
// Tests live in tests/ and consume the public API from src/. We keep
// vitest's TypeScript resolution loose (no separate tsconfig) so test
// files can import sources via `'../src/index.js'` (extension included
// for forward-compatibility with Node ESM consumers; vitest's resolver
// transparently maps `.js` → `.ts` during dev).
//
// Coverage is opt-in via `npm run test:coverage`. Default `npm test`
// is a fast pass with no coverage instrumentation.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Type-checking happens via `npm run typecheck`, not here.
    typecheck: {
      enabled: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      // Coverage targets per CONTRIBUTING.md: substrate ≥95%, rules ≥95%.
      // Enforce as the codebase fills in (currently placeholder-only).
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
