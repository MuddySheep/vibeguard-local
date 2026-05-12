# Agent skill: drop-in SQL safety pre-flight

This directory is a **drop-in single-file skill** — not a runnable
example project. There is no `package.json`, no `src/`, no `tests/`.
The artifact is `SKILL.md`. You copy it into your harness's skills
directory; your agent reads it and follows its instructions.

## The fast path: `vg-local install-skill` (v1.7.1+)

The CLI ships a subcommand that auto-detects every harness on the
current machine + project and installs SKILL.md into each:

```bash
npx vg-local install-skill              # interactive
npx vg-local install-skill --yes        # non-interactive
npx vg-local install-skill --target=claude-user   # one specific
```

It also offers an optional `CLAUDE.md` activation directive for
deterministic firing in Claude Code (the most reliable activation
lever — description-based routing is best-effort):

```bash
npx vg-local install-skill --yes --with-memory=user
# or --with-memory=project for project-scoped activation
```

Re-running the subcommand is safe — content goes between marker
comments (`<!-- vibeguard-skill-begin -->` / `<!-- vibeguard-skill-end -->`)
so it's replaced in place, never duplicated.

If you'd rather copy the file by hand, the recipes below still work.

## What gets copied where (manual install)

### Claude Code (Anthropic) — supported out of the box

Claude Code reads SKILL.md files at session start. The frontmatter
fields (`name`, `description`) feed Claude's skill-routing logic; the
body of the file is the instruction the agent follows.

Project scope:

```bash
mkdir -p .claude/skills/vibeguard-sql-safety
cp SKILL.md .claude/skills/vibeguard-sql-safety/SKILL.md
```

User scope (applies to all your Claude Code sessions):

```bash
mkdir -p ~/.claude/skills/vibeguard-sql-safety
cp SKILL.md ~/.claude/skills/vibeguard-sql-safety/SKILL.md
```

That's it. Open a Claude Code session in a project where you'd run SQL,
and the skill activates whenever the model is about to write or
execute SQL.

### Cursor — different shape, same body content

Cursor uses `.cursorrules` (or `.cursor/rules/<name>.mdc` in newer
versions). The frontmatter shape is different, and Cursor doesn't have
the same dynamic-activation routing that Claude Code does.

The easy port: strip the YAML frontmatter, paste the body into
`.cursorrules`:

```bash
# Take SKILL.md, drop the first two `---` fences and the lines
# between them, and append to .cursorrules:
sed -n '/^---$/,/^---$/!p' SKILL.md >> .cursorrules
```

Cursor will read `.cursorrules` on every prompt. That makes the skill
always-on (vs Claude Code's targeted activation), which is fine for a
pre-flight safety check that you want to apply broadly anyway.

### aider — `CONVENTIONS.md` referenced via `--read`

aider uses a static conventions file referenced at startup:

```bash
aider --read SKILL.md
# Or:
cp SKILL.md CONVENTIONS.md
aider --read CONVENTIONS.md
```

aider does not parse YAML frontmatter, but it tolerates it (the
frontmatter just becomes part of the prompt). For tidiness you can
strip it the same way as the Cursor port.

### Other harnesses

Any harness that takes a file of prose instructions for the agent can
consume this skill — the body content is self-contained. The
frontmatter only matters for harnesses that implement the Anthropic
Skills convention.

## Why this is the canonical shape and not richer

The example's frontmatter uses only two fields: `name` and
`description`. There are no `triggers`, `preconditions`, `constraints`,
or `tools` fields. Those are NOT part of the shipping Claude Code
Skills spec — they appear in some third-party proposals (Garry Tan's
tweet, various harness-author blog posts) but no major harness parses
them today.

We deliberately keep the frontmatter **conservative**: only fields a
real harness reads today. The body of SKILL.md carries the agent's
actual instructions, and prose works for every harness regardless of
spec.

If the broader agent-skill convention evolves to include richer
frontmatter, we can update SKILL.md in a minor version. Until then,
shipping aspirational fields presented as canonical would mis-set
expectations.

## What about `--reflect` (the experimental reflection mode)?

A later SDK release (`>= 1.8.0`) is expected to ship
`vg-local analyze --reflect`, which emits a richer per-catch
reflection object designed for agent-memory ingestion. The skill body
**does not depend on `--reflect`** — it uses `--format=jsonl` only,
which is stable as of `1.7.0`. When `--reflect` ships, we will publish
a sibling `SKILL.reflect.md` (or update this one) with the integration
guidance.

This staging — `--format=jsonl` first, `--reflect` as a follow-up —
is deliberate. JSONL output is stable interop today. Reflection mode
is experimental and explicitly NOT covered by the SDK's stability
commitments yet.

## Customizing the skill for your project

The SKILL.md is a starting point. Common customizations:

- **Tighten the severity bar.** If your project treats `warn`-level
  catches as blockers, change "proceed with caution" to "stop and ask"
  in the relevant section.
- **Add project-specific opt-outs.** If your project intentionally
  accepts a specific catch ID in a specific context (e.g. `SQL-015`
  `SELECT *` in analytics queries), append a section listing the
  exemption.
- **Bind a CI path.** If your project also runs `vg-local` in CI, link
  to the CI logs in the SKILL.md so the agent can reference them.

Per-project edits to SKILL.md live in your project repo, not here. The
shipping SKILL.md in this directory is the **default** that suits the
majority of consumers.

## What's NOT in this skill

- No phone-home / telemetry instructions. The SDK is local-only by
  design.
- No cloud-product upsell. The body mentions the cloud product
  factually as a layer above the local SDK; it is not a marketing
  pitch.
- No specific framework hooks (Drizzle, Prisma, Knex, etc.). The skill
  operates on SQL text. Framework-specific integration belongs in
  framework-specific docs.

## File list

```
examples/agent-skill/
├── SKILL.md      # The drop-in skill file
└── README.md     # This file — explains how to consume SKILL.md
```

## Feedback

Filed at `github.com/MuddySheep/vibeguard-local/issues`. We are
explicitly interested in:

- Harnesses where SKILL.md format needs adapting (file an example of
  the harness's expected format)
- Cases where the skill's instructions led to a false positive or
  missed catch (we'd like to refine the prose)
- Episodic-memory consumers — once `--reflect` ships, we want to learn
  from your downstream consumption patterns to inform the stable
  schema decision
