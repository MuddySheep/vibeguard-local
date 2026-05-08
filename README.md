# VibeGuard — Local

> **Static SQL safety analysis for AI agents.**
> 15 senior-DBA-level checks. Sub-millisecond. Zero network calls.
> Runs in your CLI, your editor, or right in the browser.

[![@vibeguard-dev/local](https://img.shields.io/npm/v/@vibeguard-dev/local?label=%40vibeguard-dev%2Flocal)](https://www.npmjs.com/package/@vibeguard-dev/local)
[![eslint-plugin-vibeguard](https://img.shields.io/npm/v/eslint-plugin-vibeguard?label=eslint-plugin-vibeguard)](https://www.npmjs.com/package/eslint-plugin-vibeguard)
[![@vibeguard-dev/ui](https://img.shields.io/npm/v/@vibeguard-dev/ui?label=%40vibeguard-dev%2Fui)](https://www.npmjs.com/package/@vibeguard-dev/ui)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![CI](https://github.com/MuddySheep/vibeguard-local/actions/workflows/ci.yml/badge.svg)](https://github.com/MuddySheep/vibeguard-local/actions/workflows/ci.yml)
[![Playground](https://github.com/MuddySheep/vibeguard-local/actions/workflows/playground-deploy.yml/badge.svg)](https://muddysheep.github.io/vibeguard-local/)

---

## Try it in your browser → [muddysheep.github.io/vibeguard-local](https://muddysheep.github.io/vibeguard-local/)

Paste a SQL query (or pick one of 15 ready-made samples), see what VibeGuard catches in real time. The analyzer runs entirely client-side via WASM — your SQL never leaves the page.

[![VibeGuard playground — dark theme](./docs/img/playground-dark.png)](https://muddysheep.github.io/vibeguard-local/)

**What you can do in the playground**

- **Pick from 15 catch-keyed samples** — one preset per shipped rule (`SQL-001` through `SQL-015`). Click `SQL-013` to see a `DROP TABLE` get blocked. Click `SQL-005` for a `WHERE col = NULL` footgun. The `SQL-014` chip auto-enables the default-OFF "missing RETURNING" rule for that sample.
- **Paste your own SQL** — edits re-analyze on every keystroke. CodeMirror 6 with Postgres syntax highlight, line wrapping, line numbers.
- **Toggle the AST view** — collapsible JSON tree of the parsed query tree. Useful when a catch surprises you and you want to see what the parser actually saw.
- **Share via URL** — the `share` button gzips + base64-encodes the editor's contents into the URL hash and copies it to your clipboard. Visiting that URL pre-fills the editor. No backend, no tracking.
- **Dark / light theme** — toggle in the top-right, persisted in `localStorage`.
- **Responsive** — works on phones; the editor and results panel stack on narrow viewports.

| Light theme | AST viewer |
|---|---|
| ![Light theme — DROP TABLE block catch](./docs/img/playground-light.png) | ![AST viewer expanded](./docs/img/playground-ast.png) |

---

## The same analysis, programmatically

The playground is just a UI wrapper around the published npm packages. Everything you see in-browser is also available in your project:

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

CLI for the lazy:

```bash
npx @vibeguard-dev/local init                 # scaffold a sample + lint:sql script
vg-local analyze 'src/**/*.sql'               # CI-friendly; exits 1 if any block-severity catch
vg-local analyze 'src/**/*.sql' --fix         # apply autofixes for SQL-001/005/006/011
vg-local analyze 'src/**/*.sql' --fix-dry-run # print a diff; don't write
```

Full surface, examples, and architecture rationale: [`packages/sdk/README.md`](./packages/sdk/README.md).

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

Now `` sql`SELECT id FROM users WHERE active = NULL` `` underlines `active = NULL` with the SQL-005 catch — and `--fix` turns it into `IS NULL`, just like Prettier.

Full plugin docs: [`packages/eslint-plugin/README.md`](./packages/eslint-plugin/README.md).

### `@vibeguard-dev/ui` — the design system the playground is built on

```bash
npm install @vibeguard-dev/ui react react-dom
```

```ts
import '@vibeguard-dev/ui/tokens.css';
import '@vibeguard-dev/ui/styles.css';
import { CatchCard, ThemeToggle, Mesh } from '@vibeguard-dev/ui';
```

Tokens (dark + light themes), `CatchCard`, `SeverityBadge`, `CodeBlock`, `Nav`, `ThemeToggle`, `Mesh` / `Grain` atmosphere primitives. Pre-1.0 — internal-API breakage between minor versions is allowed while the surface settles. Full inventory: [`packages/ui/README.md`](./packages/ui/README.md).

---

## The 15 catches

Each catch has a stable code (e.g. `SQL-001`), a severity, a confidence range, and a docs page. **Catch IDs are forever-stable** — once published, an ID always means the same thing (see [`STABILITY.md`](./packages/sdk/STABILITY.md)).

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

## What this is NOT

This is **static analysis only**. It checks the *shape* of your SQL. It does NOT:

- compare your agent's stated intent against what the SQL would actually do
- estimate real blast radius from the upstream Postgres planner
- provide tamper-evident audit logging
- offer human-in-the-loop escalation for grey-zone queries
- track per-agent behavioral baselines over time

For those, you want **VibeGuard Cloud** — the wire-protocol proxy and MCP server this repo is the static-analysis layer of. The two are designed to work together: the SDK locally, the Cloud in production.

## Repo layout

```
vibeguard-local/
├── packages/
│   ├── sdk/              # @vibeguard-dev/local — analyzer + CLI
│   ├── eslint-plugin/    # eslint-plugin-vibeguard — sql`…` rule
│   └── ui/               # @vibeguard-dev/ui — design tokens + React components
├── apps/
│   └── playground/       # the live web playground
└── .github/workflows/
    ├── ci.yml                  # typecheck + lint + test + build + size on every push
    ├── playground-deploy.yml   # build → deploy to GitHub Pages
    └── release.yml             # creates draft GitHub Release on `v*` tag push
```

[pnpm workspace](https://pnpm.io/workspaces). Use `corepack enable` to pick up the version pinned in `package.json`, then:

```bash
pnpm install
pnpm -r --if-present build       # build first — workspace deps resolve types via dist/
pnpm -r --if-present typecheck
pnpm -r --if-present test
```

Full architecture and contribution process: [`packages/sdk/CONTRIBUTING.md`](./packages/sdk/CONTRIBUTING.md), [`packages/sdk/ARCHITECTURE.md`](./packages/sdk/ARCHITECTURE.md).

### Dialect support

VibeGuard parses **Postgres SQL only**, via libpg-query (Postgres's own parser).

Queries in MySQL, MariaDB, or SQLite dialects will fail to parse. The most common surface for this is placeholder syntax: Postgres uses `$1, $2, $3`, while MySQL/MariaDB and many ORMs use `?`. A query like `INSERT INTO t (a, b) VALUES (?, ?)` will error with `syntax error near "?,?"` rather than running the rule analysis.

Multi-dialect support (MySQL, MariaDB, SQLite) is tracked in [#1](https://github.com/MuddySheep/vibeguard-local/issues/1). It is not scheduled for v1.x. Most catches are dialect-agnostic in principle, so it's not impossible — it's a parser and test-surface investment that hasn't been made yet.

If you're using a non-Postgres dialect and want this prioritized, please 👍 the issue and leave a comment with your stack — that signal genuinely shapes the roadmap.

## License

[Apache 2.0](./LICENSE) across the whole workspace. See [`packages/sdk/NOTICE`](./packages/sdk/NOTICE) for attribution requirements that travel with derivative works.

## About

VibeGuard is a wire-protocol security layer for AI agents that write SQL. This repo is the open-source static-analysis component of the broader product.
