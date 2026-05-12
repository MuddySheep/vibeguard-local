# Reflect mode (EXPERIMENTAL)

> **Status:** Experimental. The reflection schema is `vg-reflect/0`
> and is explicitly NOT under the SDK's semver commitments. See
> [STABILITY.md → Reflection output schema (EXPERIMENTAL)](../STABILITY.md#reflection-output-schema-experimental)
> for the graduation contract.

## What this is

`vg-local analyze --reflect` (or equivalently `--format=reflect`)
emits one *reflection* JSON object per catch — a structured record
designed to be appended to an agent's episodic-memory or
lessons-learned file. The shape adapts the SDK's already-existing
catch fields (`title`, `detail`, `fix`, `threatCategories`,
`severity`, `confidence`) to the salience-scoring language emerging
in the agent-memory literature:

- `pain_score` (0–10) — how much this catch firing hurt
- `importance` (0–10) — how much weight to give the lesson
- `reflection` — a short paragraph the agent's memory layer can
  ingest verbatim
- `suggested_lesson` — a one-line rule-of-thumb keyed on the catch
  ID, framed as forward-looking advice

## Why this exists

A static analyzer catches today's bad SQL. A *teacher* compounds: the
agent that ingested yesterday's lesson is less likely to emit
tomorrow's same mistake. The article-driven thesis behind this mode
is that agents with structured memory loops can internalize lessons
keyed by `code` over time — `SQL-013` ("DROP TABLE — irreversible")
stops needing the wall once the lesson is in the agent's semantic
memory.

This mode does not change *what* the SDK catches. It changes the
*shape* the catch arrives in for downstream consumers that have a
memory loop.

## One concrete recipe

The simplest consumption: append the suggested lessons to a project's
`LESSONS.md` file, deduped:

```bash
vg-local analyze 'src/**/*.sql' --reflect \
  | jq -r '"- \(.suggested_lesson)"' \
  | sort -u \
  >> LESSONS.md
```

`LESSONS.md` is then a growing rolodex of one-line rules-of-thumb the
agent's `--read LESSONS.md`-style mechanism can consult on subsequent
runs. The next time the agent considers writing SQL that would fire
`SQL-013`, the lesson is already in context.

## A richer recipe — per-run reflection log

Append the full reflection objects to a project-level NDJSON log:

```bash
vg-local analyze 'src/**/*.sql' --reflect \
  >> .vibeguard/reflections.jsonl
```

Downstream tooling can then:

```bash
# Most-painful catches across all history:
jq -s 'sort_by(-(.pain_score * .importance)) | .[0:10]' \
  .vibeguard/reflections.jsonl

# Recurrence count per catch code:
jq -r '.code' .vibeguard/reflections.jsonl | sort | uniq -c | sort -rn
```

The third multiplier in the salience formula —
`pain_score * importance * recurrence` — is something *your harness*
computes from the log; the SDK emits one reflection per catch firing,
and recurrence is inherent in the count of lines per `code`.

## What the emitter does and does not do

**It does:**

- Synthesize a `reflection` paragraph from existing catch fields. The
  default template is good enough for the majority of catches; rules
  with notably awkward template output can ship an optional override
  in a future story.
- Map `severity` → `result` + `pain_score` deterministically.
- Map `confidence` → `importance` (linear, rounded).
- Set `timestamp` to `new Date().toISOString()` at emit time.
- Normalize `file` to forward slashes.
- Identify itself with `skill: "vibeguard-sql-safety"` — the same
  name as the canonical [`examples/agent-skill/SKILL.md`](../examples/agent-skill/).

**It does NOT:**

- Emit raw SQL bytes. The `action` field is structural
  (`"vibeguard catch SQL-NNN in <file>:<line?>"`). This is a privacy
  decision — reflection output is intended to be appended to
  long-lived memory files, and leaking SQL would let the memory
  surface accumulate customer data over time.
- Score recurrence. That's downstream — count `.code` occurrences in
  your accumulated log to derive recurrence.
- Adapt to harness-specific memory formats. Adapt your harness to
  consume the NDJSON shape; the SDK keeps one stable emitter.
- Phone home, send telemetry, or learn anything itself. The SDK is
  local-only.

## Mutual exclusivity with `--format`

`--reflect` is sugar for `--format=reflect`. If you pass both:

```bash
vg-local analyze ... --reflect --format=jsonl
# exit code 2, usage error: --reflect conflicts with --format=jsonl
```

Either drop `--reflect` or use `--format=reflect` — pick one,
consistently with the established `--fix` / `--fix-dry-run`
exclusivity pattern.

## Where this goes next

When the schema graduates to stable (`vg-reflect/1`) — see
[STABILITY.md](../STABILITY.md#reflection-output-schema-experimental)
for the graduation criteria — the field list above moves into the
stable section of STABILITY.md and gets the same semver commitments
the JSONL output already has. Until then, do not pin production
tooling to specific reflection-field names without acknowledging the
risk explicitly in your own code.

If you have an opinion on the schema shape — fields that should be
added, fields that are noise, mappings that feel wrong — please file
an issue at
[github.com/MuddySheep/vibeguard-local/issues](https://github.com/MuddySheep/vibeguard-local/issues).
This is exactly the moment when consumer feedback shapes the V1
contract.
