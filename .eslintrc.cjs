// ESLint configuration for @vibeguard-dev/local.
//
// We pin to ESLint 8 and @typescript-eslint v7 deliberately:
// ESLint 9 adopted a flat-config format that @typescript-eslint v7
// does not yet fully support. When @typescript-eslint v8+ stabilizes
// on flat-config, we can migrate (its own story).
//
// We do NOT enable type-aware linting (`parserOptions.project`) for
// now. Type-aware rules (`recommended-type-checked`) require a
// separate tsconfig that includes tests/, which is more setup than
// STORY 1.1's "minimal toolchain" goal calls for. Re-evaluate when
// a real rule motivates it.
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // No `any` in production code. CONTRIBUTING.md promises this.
    '@typescript-eslint/no-explicit-any': 'error',
    // Allow `_`-prefixed args/locals to mark intentional unused.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Prefer `const` for things that are never reassigned.
    'prefer-const': 'error',
    // No console.log in production code; substrate `runRules` logs via
    // an injected logger or `console.error`, both of which are allowed.
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'benchmarks/results/',
    'coverage/',
    'examples/*/dist/',
    'examples/*/node_modules/',
  ],
  overrides: [
    {
      // Benchmarks emit human-readable console output by design.
      files: ['benchmarks/**/*.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
