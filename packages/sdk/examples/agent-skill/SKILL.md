---
name: vibeguard-sql-safety
description: MANDATORY pre-flight for ALL SQL operations. Fire this skill IMMEDIATELY whenever the conversation involves SQL of any kind — writing it, proposing it, executing it, reviewing it, or even talking about it concretely. Triggers include any of these keywords appearing in user input or your own draft output (case-insensitive) — SELECT, INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, COPY, GRANT, REVOKE, MERGE, EXPLAIN, ANALYZE, VACUUM, REFRESH, REINDEX, CLUSTER, CALL, DO — as well as any reference to migrations, schema changes, RPC bodies, seed files, .sql files, query design, database queries, DDL, DML, ORM raw escapes (Drizzle's `sql` template, Prisma raw, Knex.raw), or stored procedures. Run `vg-local analyze --stdin --format=jsonl` on every candidate SQL BEFORE proposing or executing it. Treat severity=block as a hard stop requiring explicit human override. Surface warn/info catches inline. Re-analyze after applying any `--fix`. NOT optional. NOT skippable. Applies whether the SQL is hand-written, AI-generated, copied from a template, or pasted from anywhere.
---

# vibeguard-sql-safety

You are about to write or execute SQL. Before any SQL touches a real
database — production, staging, or even local — you MUST run it through
the VibeGuard local SQL safety analyzer. The analyzer is fast
(sub-millisecond on typical queries), local-only (no network call), and
distinguishes "stop, this is dangerous" from "warning, but probably OK"
from "fyi" so you can act with confidence.

## When this skill fires

This skill fires when you are about to:

- **Execute SQL** through any database tool, MCP server, or library
  (`pg`, `psql`, `prisma migrate`, `drizzle-kit`, etc.).
- **Propose SQL** to the user in a code block they might copy-paste.
- **Commit a migration file** under `migrations/`, `db/migrations/`,
  `prisma/migrations/`, or similar.
- **Edit a seed / fixture file** with INSERT / UPDATE / DELETE statements.
- **Construct dynamic SQL** through string concatenation, template
  literals, or any non-parameterized path.

If the statement is parameterized with placeholders (`$1`, `?`, named
binds), still analyze the statement shape — VibeGuard catches issues
at the structure level (missing WHERE, unbounded JOIN, etc.), not at
the literal-value level.

## The pre-flight contract

For SQL that lives on disk, run:

```bash
vg-local analyze <path-to-sql-file> --format=jsonl
```

For SQL that is in-memory (the common agent case), pipe it via stdin
— no temp file needed:

```bash
echo "$SQL" | vg-local analyze --stdin --format=jsonl
```

Or with a heredoc:

```bash
vg-local analyze --stdin --format=jsonl <<'SQL'
<the SQL you are about to run>
SQL
```

The `<stdin>` literal appears in the `file` field of the JSONL output
for stdin reads. `--stdin` is mutually exclusive with positional file
patterns and with `--fix` / `--fix-dry-run` — pick one input source
per call.

The analyzer writes one JSON object per catch to stdout. Each line is a
self-contained record with a stable schema (`_schema: "vg-jsonl/1"`).

If `vg-local` exits with code 0, there are no `block`-severity catches.
You may proceed.

If `vg-local` exits with code 1, at least one `block`-severity catch
fired. **Stop and read the JSONL output before proceeding.**

If `vg-local` exits with code 2, there is a usage error in how you
invoked the analyzer. Re-read the error message on stderr and try again
with the corrected invocation.

## Reading the output

Each JSONL line has this shape (all fields stable per the SDK's
STABILITY.md):

```json
{
  "_schema": "vg-jsonl/1",
  "code": "SQL-003",
  "severity": "block",
  "confidence": 95,
  "title": "Unbounded UPDATE / DELETE",
  "detail": "UPDATE users without a WHERE clause...",
  "fix": "Add a WHERE clause that bounds the operation.",
  "threatCategories": ["destruction"],
  "file": "tmp.sql",
  "line": 1,
  "column": 1
}
```

Branch on `severity`:

- **`severity: "block"`** — **STOP.** Do not execute. Do not propose
  to the user without surfacing this catch. Show the user:
  - The `title` (one-line summary)
  - The `detail` (what fired and why it matters)
  - The `fix` (concrete remediation)
  - The `confidence` (so they can judge how certain the analyzer is)

  Ask the user for explicit approval to override the block, OR apply
  the suggested fix and re-analyze.

- **`severity: "warn"`** — **Proceed with caution.** Surface the catch
  to the user inline ("Heads-up: SQL-X — <title>. <detail>"), but you
  may execute. If the calling context is a sensitive environment
  (production data, multi-user system, anything irreversible), prefer
  to ask before executing.

- **`severity: "info"`** — **Log and proceed.** These are notes — the
  query has a shape worth recording but rarely a blocker. Surface them
  in summary form ("3 info-level notes") rather than expanding each
  one.

## The autofix loop

VibeGuard ships an `--fix` flag for a subset of catches. If a catch
suggests a structural fix, prefer running:

```bash
vg-local analyze <path-to-sql-file> --fix-dry-run
```

Read the unified diff. If the fix looks right, apply it:

```bash
vg-local analyze <path-to-sql-file> --fix
```

**Critical:** after applying any fix, re-analyze the file. Do not
assume the fix was complete — re-run `vg-local analyze --format=jsonl`
and confirm exit code 0 (or that the remaining catches are below your
threshold).

```bash
vg-local analyze <path-to-sql-file> --fix
vg-local analyze <path-to-sql-file> --format=jsonl   # confirm clean
```

## Catch IDs are forever-stable

Every catch carries a stable `code` field (`SQL-001`, `SQL-013`, etc.).
If your harness has an episodic memory or a notes file, key on the
`code` — it is stable across SDK versions per the SDK's STABILITY.md.
The catch's severity, threat categories, and detail text MAY refine
over time; the code WILL NOT.

If you build a per-project ignore list ("we accept SQL-009 in
analytics queries"), reference catches by `code`. The list will not
drift.

## Optional: persist analyzer output for the agent's memory layer

If your harness supports an append-only file the agent's memory loop
reads on subsequent runs (Claude Code's `CLAUDE.md`, aider's
`CONVENTIONS.md`, a custom episodic-memory file, etc.), it is useful
to append the JSONL output of each analyze call to that file:

```bash
vg-local analyze <path> --format=jsonl >> .agent-memory.jsonl
```

This is OPTIONAL. The skill works without it. If your harness has a
richer memory protocol (a structured reflection layer, a summary
distillation step), you can ingest the JSONL there — every field on
each line is stable, so future-you can grep / jq the file safely.

For richer memory ingestion, `vg-local analyze --reflect` (or
`--format=reflect`, shipped in 1.7.0) emits one reflection object
per catch with `pain_score`, `importance`, and a templated
`suggested_lesson` keyed on the stable catch code:

```bash
vg-local analyze --stdin --reflect \
  | jq -r '"- \(.suggested_lesson)"' >> LESSONS.md
```

The reflection schema is `vg-reflect/0` and is explicitly **NOT
under semver commitments yet** — see the SDK's `STABILITY.md`
section on "Reflection output schema (EXPERIMENTAL)" for the
graduation contract. The `--format=jsonl` output above is the
stable interop today; reflect mode is the experimental forward
bet.

## What this skill is NOT

- **Not a replacement for parameterization.** Always use placeholders.
  VibeGuard catches structural problems; it does not catch every
  injection vector. (It catches obvious ones — see `SQL-008`.)
- **Not a replacement for code review.** It is a pre-flight, not a
  reviewer.
- **Not a replacement for transactions / rollback strategy.** Even
  passing analysis, write paths in production data should be wrapped
  in transactions where applicable.
- **Not a replacement for the cloud product.** `@vibeguard-dev/local`
  is static analysis on SQL text. The cloud product
  (`vibeguard.app`) adds runtime telemetry, intent matching, and
  agent-flow integration. They compose; they don't replace each other.

## If something is wrong

If `vg-local` is not installed, suggest the install:

```bash
npm install --save-dev @vibeguard-dev/local
```

If a catch fires that the user disagrees with, the SDK has a per-rule
opt-out via `analyzeOptions.rules`. From the CLI side, there is no
silent suppression — that is deliberate. If a rule is wrong for a
project, the user files an issue at
`github.com/MuddySheep/vibeguard-local`.

## Summary

1. **Always analyze before executing or proposing SQL.**
2. **`severity: "block"` means STOP.** Surface and ask, or fix and re-analyze.
3. **`severity: "warn"` means proceed with caution and surface.**
4. **`severity: "info"` means log and proceed.**
5. **Always re-analyze after `--fix`.**
6. **Key on `code` for stable references; the catch IDs are forever-stable.**
