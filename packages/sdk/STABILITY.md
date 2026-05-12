# Stability commitments

`@vibeguard-dev/local` is designed to be safe for production use. This
document is the contract: what changes when, and what we promise to
keep stable forever.

## Catch IDs are forever-stable

Once a catch ID like `SQL-001` ships in a public release, that ID always
means the same thing. Specifically:

- **An ID is never reused.** If a catch is removed from the SDK (rare,
  but possible), its ID is permanently retired. The next new catch
  gets the next number, never the retired one.
- **The threat shape an ID represents stays consistent.** `SQL-003`
  ("Unbounded UPDATE / DELETE") will always be about unbounded
  destructive writes. We can refine the detection logic, but the
  category meaning stays.
- **Customers can write `if (catch.code === 'SQL-003')` and rely on it.**
  That's the whole point of stable IDs.

If you depend on a catch's behavior in your code, the ID is the right
thing to key on.

## Severity changes are major-version only

If a catch's severity changes (e.g., `warn` → `block`), that's a major
version bump. Customers shouldn't be surprised by a catch suddenly
blocking what previously only warned.

The reverse (`block` → `warn`) is also major-version. Either direction
is a behavior change that consumers may have built logic around.

## Confidence range adjustments are minor versions

A catch's confidence range can be tightened (e.g., 70–85 → 75–85) or
expanded (e.g., 70–85 → 65–90) in minor versions, as long as the
direction makes sense for the rule's actual detection accuracy.

## Detection-logic improvements are minor versions

If a rule starts catching new edge cases or handling false positives
better, that's a minor version bump. The catch's identity doesn't change
— it's still detecting the same threat shape — it just does it more
accurately.

## Bug fixes are patch versions

Pure bugs (panics, type errors, incorrect output structure) are patch
versions.

## Public API surface stays minimal

The SDK's public API is small on purpose:

- `analyze(sql, options?) → AnalysisResult`
- The `Catch` and `AnalysisResult` types
- The `RULES` registry (read-only)
- The substrate helpers (`astWalk`, `extractFromTables`,
  `extractColumns`) — exposed for users who want to write their own
  static checks using the same primitives

Adding to this surface is a minor version. Removing or renaming
anything in it is a major version.

## Peer-dependency policy

`libpg-query` is the only required peer dependency. Major version
changes to `libpg-query` (which represent Postgres parser version
updates) are major versions of this SDK as well — even if our public
API doesn't change — because the AST shapes the SDK reasons over may
have shifted.

## How to depend on this SDK in production

- Use a caret range in `package.json` (`"@vibeguard-dev/local": "^1.0.0"`)
- Pin to a specific version if you want zero auto-updates
- Watch the [CHANGELOG](./CHANGELOG.md) for the once-a-quarter
  major-version cadence we plan to maintain (no surprise majors)

## JSONL output schema

`vg-local analyze --format=jsonl` (and its alias `--format=ndjson`)
emit one JSON object per catch on stdout. The schema below is a
forever-stable contract under the same semver rules as the `Catch`
interface:

- **Field removal / rename** → major version
- **Field addition** → minor version (consumers MUST ignore unknown fields)
- **Semantic change to an existing field** → major version
- **Bug fixes** (escaping, ordering, normalization) → patch version

The schema-version tag is embedded on every line as the `_schema`
field. The current value is `vg-jsonl/1`. The number bumps on any
major schema change so consumers can branch by reading `_schema`
first.

### V1 fields (`_schema: "vg-jsonl/1"`)

Required on every line:

| Field | Type | Notes |
|---|---|---|
| `_schema` | `string` | Constant `"vg-jsonl/1"` for this version |
| `code` | `string` | Catch ID (e.g. `"SQL-001"`). Forever-stable per the "Catch IDs are forever-stable" section. |
| `severity` | `string` | One of `"block"`, `"warn"`, `"info"` |
| `confidence` | `number` | Integer 0–100 |
| `title` | `string` | Human-readable catch title |
| `detail` | `string` | Plain-English explanation of what fired and why |
| `fix` | `string` | Plain-English suggested remediation |
| `threatCategories` | `string[]` | Non-empty array of categories (see `ThreatCategory` in `src/types.ts`) |
| `file` | `string` | File path relative to the CLI's cwd, **forward-slash normalized** (no platform-specific separators) |

Optional, present only when the underlying `Catch.location` is set:

| Field | Type | Notes |
|---|---|---|
| `line` | `number` | 1-based line number into the source SQL |
| `column` | `number` | 1-based column |

### Output discipline

The JSONL stream on **stdout** carries only catch records. The
following are deliberately NOT in the stream:

- Summary / count lines (consumers can sum severities themselves)
- Parse errors (those go to **stderr** as plain text, unchanged from
  human mode)
- Skip warnings (large files etc. → stderr)
- Autofix informational lines (e.g. "fixed file.sql (N changes)") —
  the JSONL output reflects the post-fix remaining catches; the
  informational trailer is suppressed
- Unified-diff output from `--fix-dry-run` (suppressed in JSONL mode;
  re-run with `--format=human` to view the diff)

This split — JSON on stdout, human diagnostics on stderr — matches the
convention used by `ripgrep --json`, `jq`, and similar pipe-friendly
tools. Agent harnesses can rely on stdout being either empty or a
stream of valid JSONL records.

### Field ordering

Field order in the emitted JSON is fixed (matches the order in the
table above) so two runs over the same input produce byte-identical
output. This is helpful for diffing against a baseline and for cache
keys that hash JSONL output.

The fixed order is a **stable** behavior, not a binding contract:
consumers MUST NOT rely on it (JSON is unordered by spec), but they
CAN rely on it for tooling that benefits from determinism.

## Reflection output schema (EXPERIMENTAL)

`vg-local analyze --reflect` (and its canonical equivalent
`--format=reflect`) emit one *reflection* JSON object per catch on
stdout — a structured record designed for ingestion into an agent's
episodic-memory / lessons-learned layer.

**The reflection schema is EXPERIMENTAL.** It is explicitly NOT under
the semver commitments above. Fields may be added, removed, renamed,
or have their semantic meaning changed between any two SDK releases
(including minor and patch versions) while the schema is in V0.

The `_schema` field on each line currently reads `vg-reflect/0`. The
trailing `/0` is the experimental marker. When the schema graduates
to stable, the tag bumps to `vg-reflect/1`, and the same semver rules
that apply to the JSONL output above kick in.

### Why ship an experimental schema at all

The reflection shape is a bet on the agent-memory pattern (skills +
episodic-memory + reflection-loop ingestion) becoming the dominant
way harnesses consume failure context. Shipping V0 lets the schema
shake out under real consumption before we make a binding promise.

If the pattern doesn't crystallize, V0 sunsets quietly — either by
being removed in a major version or by being supplanted by a V1 with
a different shape entirely. Consumers that branched on `_schema`
will not break in either case (V0 was never a contract).

### Graduation to V1 (stable)

The V0 schema graduates to `vg-reflect/1` and gains the full semver
commitments above when, in this order:

1. **At least one external consumer has shipped** — a real harness or
   tool that reads reflection output in production, demonstrating the
   schema's actual usefulness.
2. **A 30-day field-stability hold** — during which any field
   changes either land or do not. After 30 days with no changes, the
   schema is frozen.
3. **A `[1.X.0]` minor-version release** promotes the schema with a
   CHANGELOG entry and a STABILITY.md amendment. The amendment moves
   the schema documentation out of this "experimental" section and
   into the "JSONL output schema"-style table directly above.

Until graduation, do not pin production tooling to specific
reflection-field names without acknowledging the risk explicitly in
your own code.

### V0 fields (`_schema: "vg-reflect/0"`)

Required on every line:

| Field | Type | Notes |
|---|---|---|
| `_schema` | `string` | Constant `"vg-reflect/0"` for V0 |
| `timestamp` | `string` | ISO 8601 (`new Date().toISOString()`). Set at emit time. |
| `skill` | `string` | Constant `"vibeguard-sql-safety"` — matches the `name:` frontmatter in [`examples/agent-skill/SKILL.md`](./examples/agent-skill/SKILL.md) |
| `code` | `string` | Catch ID (e.g. `"SQL-001"`). Same forever-stable IDs as elsewhere. |
| `severity` | `string` | One of `"block"`, `"warn"`, `"info"` |
| `confidence` | `number` | Integer 0–100 |
| `result` | `string` | `"blocked"` (severity=block) / `"warned"` (warn) / `"flagged"` (info) |
| `pain_score` | `number` | Integer 0–10. Currently `block=9, warn=5, info=2`. |
| `importance` | `number` | Integer 0–10. Currently `round(confidence / 10)`, clamped. |
| `threatCategories` | `string[]` | Non-empty array, same as JSONL output |
| `file` | `string` | Forward-slash normalized, same as JSONL output |
| `action` | `string` | Structural description, e.g. `"vibeguard catch SQL-001 in src/q.sql"`. **NEVER contains raw SQL bytes** — reflection output is intended to be appended to long-lived memory files; leaking SQL into that surface would be a problem the SDK should never cause. |
| `reflection` | `string` | A 1–2 sentence paragraph synthesized from the catch's `title`, `detail`, and `threatCategories`. **Template-generated in V0** — no per-rule hand-written reflection prose is stored on the rule definition. A future minor version may add an optional per-rule override; that override would be additive. |
| `suggested_lesson` | `string` | A one-line rule-of-thumb derived from the catch's `fix` field, framed as a forward-looking lesson (`"Before executing SQL that matches <code> ..."`). |

Optional, present only when the underlying `Catch.location` is set:

| Field | Type | Notes |
|---|---|---|
| `line` | `number` | 1-based |
| `column` | `number` | 1-based |

### Privacy callout

Reflection output is designed for ingestion into long-lived memory
files. The `action` field is **structural** — it identifies the
catch and the file but **does not include raw SQL bytes**. This is
deliberate: a memory file that accumulates "the agent tried to run
`UPDATE users SET email = 'real@email.com' WHERE id = 42`" would
exfiltrate customer data into a notes file over time. The catch's
`code` + `file` is enough context for the agent to look back at the
source if needed; the SQL itself stays out of the memory stream.

If your harness builds a richer memory shape that includes SQL text,
that's your choice to make — but the SDK will never emit it on your
behalf via this mode.
