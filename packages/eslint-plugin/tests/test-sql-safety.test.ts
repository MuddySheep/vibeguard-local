import { RuleTester } from 'eslint';
import { beforeAll, describe, it } from 'vitest';

import { init } from '@vibeguard-dev/local';

import { sqlSafetyRule } from '../src/rules/sql-safety.js';

// V1.4 — vibeguard/sql-safety integration tests via ESLint's RuleTester.
//
// RuleTester runs the rule end-to-end against parsed source code and
// asserts both that the right errors fire AND that --fix produces
// the expected output. It's the ESLint-canonical way to test plugin
// rules.
//
// The plugin's index.ts top-level-awaits init() at module load, but
// these tests import the rule directly (bypassing index.ts), so we
// init() in beforeAll explicitly.

beforeAll(async () => {
  await init();
});

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('vibeguard/sql-safety — RuleTester', () => {
  it('runs the standard valid/invalid suite', () => {
    ruleTester.run('sql-safety', sqlSafetyRule, {
      // -----------------------------------------------------------------
      // VALID — these should NOT report any errors
      // -----------------------------------------------------------------
      valid: [
        // Plain string with no SQL tag — ignored
        { code: "const s = 'SELECT * FROM users WHERE x = NULL'" },

        // Tagged template with non-default tag — ignored
        { code: "const q = html`SELECT * FROM users WHERE x = NULL`" },

        // Clean SQL — no rule fires
        {
          code: "const q = sql`SELECT id, email FROM users WHERE id = 1`",
        },

        // Substitution placeholder works — `${val}` doesn't trip SQL-005
        {
          code: 'const q = sql`SELECT id FROM users WHERE id = ${userId}`',
        },

        // Custom tag list excludes default `sql` tag — `sql\`...\`` ignored
        {
          code: "const q = sql`SELECT * FROM t WHERE x = NULL`",
          options: [{ tags: ['raw'] }],
        },
      ],

      // -----------------------------------------------------------------
      // INVALID — these SHOULD report errors and (where applicable)
      // produce a specific autofix output
      // -----------------------------------------------------------------
      invalid: [
        // SQL-005 = NULL — fires + auto-fixes to IS NULL
        {
          code: 'const q = sql`SELECT id FROM users WHERE active = NULL`',
          errors: [{ message: /SQL-005/ }],
          output:
            'const q = sql`SELECT id FROM users WHERE active IS NULL`',
        },

        // SQL-006 OFFSET without ORDER BY — placeholder fix
        {
          code: 'const q = sql`SELECT id FROM t LIMIT 10 OFFSET 20`',
          errors: [{ message: /SQL-006/ }],
          output:
            'const q = sql`SELECT id FROM t ORDER BY 1 LIMIT 10 OFFSET 20`',
        },

        // SQL-001 cartesian — placeholder fix to JOIN ON TRUE + TODO
        {
          code: 'const q = sql`SELECT a.id, b.id FROM accounts a, billing b`',
          errors: [{ message: /SQL-001/ }],
          output:
            'const q = sql`SELECT a.id, b.id FROM accounts a JOIN billing b ON TRUE /* TODO(vibeguard SQL-001): replace TRUE with a real predicate */`',
        },

        // SQL-013 DROP TABLE — fires but has no fixer (output === null
        // tells RuleTester the rule did not produce a fix)
        {
          code: 'const q = sql`DROP TABLE users`',
          errors: [{ message: /SQL-013/ }],
          output: null,
        },

        // db.query() pattern with callExpressions option
        {
          code: 'await db.query(`SELECT id FROM users WHERE x = NULL`)',
          options: [{ callExpressions: ['db.query'] }],
          errors: [{ message: /SQL-005/ }],
          output:
            'await db.query(`SELECT id FROM users WHERE x IS NULL`)',
        },

        // Substitution preserved through autofix — `${userId}` round-trips
        {
          code:
            'const q = sql`SELECT id FROM users WHERE active = NULL AND id = ${userId}`',
          errors: [{ message: /SQL-005/ }],
          output:
            'const q = sql`SELECT id FROM users WHERE active IS NULL AND id = ${userId}`',
        },

        // Per-rule opt-in via options.rules — SQL-014 default-OFF
        {
          code: "const q = sql`INSERT INTO users (email) VALUES ('a@b.com')`",
          options: [{ rules: { 'sql-014': { enabled: true } } }],
          errors: [{ message: /SQL-014/ }],
          output: null,
        },
      ],
    });
  });
});
