# Changelog

All notable changes to `eslint-plugin-vibeguard` will be documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-08

First release. Wraps `@vibeguard-dev/local`'s SQL safety analyzer in
an ESLint rule that runs against tagged template literals and
configured call expressions, with autofix support for the four rules
that have fixers (SQL-001, SQL-005, SQL-006, SQL-011).

### Added

- **`vibeguard/sql-safety` rule.** Visits `TaggedTemplateExpression`
  and `CallExpression` AST nodes; if the tag/callee matches the
  configured list, extracts the SQL with `$N` placeholders for
  `${expr}` substitutions, runs the VibeGuard analyzer, and reports
  every catch as an ESLint diagnostic. Catches whose SDK rules have
  fixers attach an `--fix`-compatible callback that re-inlines
  `${expr}` substitutions when emitting the fixed template literal.
- **Plugin options:**
  - `tags` (default `['sql']`) — tag names that mark a template
    literal as SQL.
  - `callExpressions` (default `[]`) — function/member names whose
    first template-literal argument is treated as SQL.
  - `rules` — per-rule overrides forwarded to the analyzer (same
    shape as `@vibeguard-dev/local`'s `AnalyzeOptions.rules`).
- **`recommended` config** — enables `vibeguard/sql-safety` at error
  severity with default options. Use via
  `vibeguard.configs.recommended` in flat config.
- **Top-level await init.** The plugin's entry awaits `init()` once
  at module load so the WASM parser is ready before ESLint starts
  visiting AST nodes. Requires ESLint 9+ flat config (ESM).

### Architecture notes

- **Source-text edits, not AST→SQL deparse.** Mirrors the SDK's
  V1.3 fixer policy. The plugin reuses the SDK's `applyFixes()`
  runner verbatim — no rule logic forks between CLI and editor.
- **Substitution placeholders.** `${expr}` segments are replaced
  with Postgres-shaped `$N` parameter references for parsing.
  libpg-query parses these as ParamRef nodes; the SDK's rules
  ignore them; the SDK's fixers don't touch them. So the
  placeholders survive verbatim through any fix the runner
  applies, and reconstruction during autofix is a single-pass
  string replace.
- **Distribution.** ESM-only. Top-level await rules out CJS.
  Legacy `.eslintrc` support is a deferred future release.

### Known limitations

- **ESLint 9+ only.** Legacy `.eslintrc` config requires CJS, which
  doesn't support top-level await. Tracked for a future release.
- **Drizzle DSL.** Drizzle's query builder isn't a string-template
  shape; the plugin can't see SQL inside Drizzle's structural API.
  Out of scope for V1; tracked for V2 of the plugin.
- **Dynamic call expressions** (`db[name]()`) are skipped — only
  static identifier / member-expression callees match the
  configured `callExpressions` list.

## Related

- [`@vibeguard-dev/local`](https://www.npmjs.com/package/@vibeguard-dev/local) — the underlying SQL safety analyzer.
