# eslint-plugin-vibeguard

> **VibeGuard SQL safety analysis as an ESLint rule.**
> Catches dangerous SQL inside tagged template literals and supported call expressions, with autofix where possible.

[![npm version](https://img.shields.io/npm/v/eslint-plugin-vibeguard)](https://www.npmjs.com/package/eslint-plugin-vibeguard)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

---

## What it does

Wraps the [`@vibeguard-dev/local`](https://www.npmjs.com/package/@vibeguard-dev/local) static-SQL-analysis SDK in an ESLint rule. Every `sql\`...\`` you write (or every `db.query(\`...\`)`, depending on configuration) gets the same 15-catch analysis pre-flight, right in your editor.

When you write something like:

```ts
const q = sql`SELECT id FROM users WHERE active = NULL`;
```

your editor underlines `active = NULL` with the SQL-005 catch. Click `--fix` and it becomes `active IS NULL`. Same workflow as Prettier or `eslint --fix` for any other rule — instant feedback, no separate CLI run.

## Install

```bash
npm install --save-dev eslint-plugin-vibeguard libpg-query
```

`libpg-query` is a peer dependency that ships the WASM Postgres parser. ESLint 9+ is required (peer dep).

## Configure

Flat config (ESLint 9+):

```js
// eslint.config.js
import vibeguard from 'eslint-plugin-vibeguard';

export default [
  {
    files: ['**/*.{js,ts,tsx}'],
    plugins: { vibeguard },
    rules: {
      'vibeguard/sql-safety': 'error',
    },
  },
];
```

Or use the recommended preset:

```js
import vibeguard from 'eslint-plugin-vibeguard';

export default [
  vibeguard.configs.recommended,
];
```

## Options

```js
'vibeguard/sql-safety': ['error', {
  // Tag names that mark a template literal as SQL.
  // Default: ['sql']
  tags: ['sql', 'queryRaw'],

  // Function/member names whose first argument (when a template
  // literal) is treated as SQL. Default: [] (opt-in).
  callExpressions: ['db.query', 'pool.query', 'this.query'],

  // Per-rule overrides forwarded to the analyzer. Same shape as
  // the SDK's analyze() options.rules. Use to opt-in to default-OFF
  // rules (e.g. SQL-014 missing RETURNING) or to disable default-ON
  // rules for one config.
  rules: {
    'sql-014': { enabled: true },
    'sql-015': { enabled: false },
  },
}]
```

## What gets caught

The full 15-catch list lives in the [SDK README](https://www.npmjs.com/package/@vibeguard-dev/local#the-15-catches). The plugin runs the same rules; per-rule severity, confidence, and threat categories carry through unchanged.

Four catches have autofix support: SQL-001 (placeholder JOIN ON TRUE), SQL-005 (`= NULL` → `IS NULL`), SQL-006 (insert ORDER BY 1), SQL-011 (add missing GROUP BY column). The rest report a diagnostic but don't auto-fix.

## Integration examples

### postgres.js

```ts
import postgres from 'postgres';
const sql = postgres(/* ... */);

// `vibeguard/sql-safety` catches this with default config:
const result = await sql`SELECT id FROM users WHERE active = NULL`;
//                                                    ^^^^^^^^^^^^^^^
//   error  [SQL-005] NULL comparison with `=` / `<>`: ...
//          (autofix: WHERE active IS NULL)
```

### Kysely (raw SQL escapes)

```ts
import { sql } from 'kysely';

await db
  .selectFrom('users')
  .where(sql`status = NULL`)
  // ^^^^^^^^^^^^^^^^^^^^^^^
  //   error  [SQL-005] NULL comparison ...
  .execute();
```

### node-postgres (db.query pattern)

```js
// eslint.config.js
{
  rules: {
    'vibeguard/sql-safety': ['error', { callExpressions: ['client.query', 'pool.query'] }],
  },
}
```

```ts
import { Pool } from 'pg';
const pool = new Pool();

await pool.query(`UPDATE users SET email = 'x'`);
//               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//   error  [SQL-003] Unbounded UPDATE statement ...
```

## Why ESLint 9+?

The plugin's entry uses top-level `await init()` to bootstrap the libpg-query WASM parser before any rule runs. Top-level await is supported in ESM modules, which is what ESLint 9's flat config loads as. Legacy `.eslintrc` (CJS) doesn't support top-level await; that path is deferred to a future release.

## License

Apache 2.0. See [LICENSE](./LICENSE).

Built on top of [`@vibeguard-dev/local`](https://www.npmjs.com/package/@vibeguard-dev/local) — same authors, same license, same ecosystem.
