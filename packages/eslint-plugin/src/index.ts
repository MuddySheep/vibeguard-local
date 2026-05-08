// eslint-plugin-vibeguard
//
// Plugin entry. Top-level await `init()` boots the libpg-query WASM
// parser before exporting the rule registry, so by the time ESLint
// loads our rules and starts visiting AST nodes, the analyzer is
// ready and synchronous.
//
// Top-level await is the load-bearing detail: ESLint's rule context
// is sync, libpg-query's bootstrap is async. ESLint 9's ESM flat
// config supports top-level await; legacy `.eslintrc` (CJS) does
// NOT, which is why this package's peer-dep floor is `eslint@^9`
// and the build emits ESM only.

import type { Rule } from 'eslint';

import { init } from '@vibeguard-dev/local';

import { sqlSafetyRule } from './rules/sql-safety.js';

// Initialize the parser before ESLint touches a single file.
// If the environment doesn't support top-level await (e.g. running
// the plugin under a CJS-style require), this throws at module
// load — which is preferable to silently degrading to a no-op.
await init();

interface VibeGuardPlugin {
  meta: { name: string; version: string };
  rules: Record<string, Rule.RuleModule>;
  configs: {
    recommended: {
      plugins: Record<string, VibeGuardPlugin>;
      rules: Record<string, 'off' | 'warn' | 'error'>;
    };
  };
}

const plugin: VibeGuardPlugin = {
  meta: {
    name: 'eslint-plugin-vibeguard',
    version: '1.0.0',
  },
  rules: {
    'sql-safety': sqlSafetyRule,
  },
  configs: {
    /**
     * Recommended config — enables `vibeguard/sql-safety` at error
     * severity with default options. Use via:
     *
     *   import vibeguard from 'eslint-plugin-vibeguard';
     *
     *   export default [
     *     vibeguard.configs.recommended,
     *     // ...
     *   ];
     */
    recommended: {
      // Wired below — the self-reference can't sit in the literal.
      plugins: {},
      rules: {
        'vibeguard/sql-safety': 'error',
      },
    },
  },
};

// Wire the recommended config's `plugins` reference back to the
// plugin itself so `extends` consumers don't have to import twice.
plugin.configs.recommended.plugins = { vibeguard: plugin };

export default plugin;

// Named re-exports for advanced consumers building custom configs.
export { sqlSafetyRule } from './rules/sql-safety.js';
export type { SqlSafetyOptions } from './rules/sql-safety.js';
