<!-- Thanks for contributing! Please fill in this template completely. -->

## What this PR does

<!-- One sentence summary. -->

## Linked issue

<!--
Link the issue this PR addresses. New catches require an approved
proposal issue first (see CONTRIBUTING.md).
-->

Fixes #

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New catch (proposal-approved, see CONTRIBUTING.md)
- [ ] Documentation only
- [ ] Internal refactor (no behavior change)
- [ ] Substrate / build / CI change
- [ ] Breaking change (major-version-only — discussed in advance)

## Checklist

- [ ] Tests pass locally (`npm test`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Bundle-size budget respected (`npm run size`)
- [ ] If this PR adds a new catch:
  - [ ] One source file under `src/rules/sql-NNN-<slug>.ts`
  - [ ] One test file under `tests/test-sql-NNN-<slug>.ts` with **at least 10 cases**
  - [ ] One docs page under `docs/rules/sql-NNN.md`
  - [ ] Catch ID added to README's catches table
  - [ ] Catch ID added to CHANGELOG under [Unreleased]
- [ ] If this PR changes any existing catch's severity or confidence range:
  - [ ] Documented in CHANGELOG as a breaking change
  - [ ] [STABILITY.md](../STABILITY.md) policy followed (severity is major-version-only)

## Additional notes

<!-- Anything reviewers should know. AST shape decisions, false-positive concerns, etc. -->
