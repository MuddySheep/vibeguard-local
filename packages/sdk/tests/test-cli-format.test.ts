import { describe, expect, it } from 'vitest';

import { formatCatch, formatSummary } from '../src/cli/format.js';
import type { Catch } from '../src/types.js';

// V1.2 — CLI format tests.
// picocolors auto-disables ANSI when isatty=false, which is the
// vitest stdout state. So output here is plain-text and trivial
// to assert against.

const blockCatch: Catch = {
  code: 'SQL-003',
  title: 'Unbounded UPDATE statement',
  severity: 'block',
  confidence: 99,
  detail:
    'UPDATE on `users` has no WHERE clause. Every row in the table will be modified.',
  fix: 'Add a WHERE clause that scopes the update to specific rows.',
  threatCategories: ['destruction'],
};

const warnCatch: Catch = {
  code: 'SQL-005',
  title: 'NULL comparison footgun',
  severity: 'warn',
  confidence: 95,
  detail: 'WHERE col = NULL never matches; use IS NULL.',
  fix: 'Replace `= NULL` with `IS NULL`.',
  threatCategories: ['corruption'],
};

const infoCatch: Catch = {
  code: 'SQL-015',
  title: 'SELECT * — projection over-fetch',
  severity: 'info',
  confidence: 60,
  detail: 'Projection `*` returns every column.',
  fix: 'Replace the star with the explicit column list.',
  threatCategories: ['exfiltration', 'integrity'],
};

describe('formatCatch', () => {
  it('renders code, title, severity and confidence on the title line', () => {
    const out = formatCatch(blockCatch, 'src/queries.sql');
    expect(out).toContain('SQL-003');
    expect(out).toContain('Unbounded UPDATE statement');
    expect(out).toContain('block · 99');
  });

  it('renders the file path on the heading line', () => {
    const out = formatCatch(blockCatch, 'src/queries.sql');
    expect(out).toContain('src/queries.sql');
  });

  it('renders a line hint when supplied', () => {
    const out = formatCatch(blockCatch, 'src/queries.sql', 42);
    expect(out).toContain('src/queries.sql:42');
  });

  it('omits the line hint when not supplied', () => {
    const out = formatCatch(blockCatch, 'src/queries.sql');
    expect(out).not.toContain('src/queries.sql:');
  });

  it('includes the detail and fix bodies', () => {
    const out = formatCatch(blockCatch, 'q.sql');
    // Normalize whitespace so wrap-boundary breaks don't fail the
    // substring check.
    const normalized = out.replace(/\s+/g, ' ');
    expect(normalized).toContain('Every row in the table will be modified');
    expect(normalized).toContain('fix: Add a WHERE clause');
  });

  it('renders all three severity levels', () => {
    expect(formatCatch(blockCatch, 'q.sql')).toContain('block · 99');
    expect(formatCatch(warnCatch, 'q.sql')).toContain('warn · 95');
    expect(formatCatch(infoCatch, 'q.sql')).toContain('info · 60');
  });

  it('word-wraps long detail strings', () => {
    const longCatch: Catch = {
      ...blockCatch,
      detail:
        'A detail that is quite long and should be wrapped across multiple lines because it exceeds the seventy-two-column width budget for the rendered output block in the CLI presenter.',
    };
    const out = formatCatch(longCatch, 'q.sql');
    const detailLines = out
      .split('\n')
      .filter((l) => l.includes('detail') || /^\s+[A-Z]/.test(l));
    // No single line should exceed ~80 chars (indent + width).
    for (const line of detailLines) {
      expect(line.length).toBeLessThanOrEqual(85);
    }
  });
});

describe('formatSummary', () => {
  it('green check when zero catches', () => {
    const out = formatSummary(0, 5, 0);
    expect(out).toContain('0 catches in 5 files');
    // picocolors disabled in test (no TTY), so no ANSI codes — just
    // assert the summary string shape.
    expect(out).toContain('✓');
  });

  it('uses singular "catch" / "file" when count is 1', () => {
    expect(formatSummary(1, 1, 0)).toContain('1 catch in 1 file');
    expect(formatSummary(1, 1, 1)).toContain('1 catch in 1 file');
  });

  it('plural otherwise', () => {
    expect(formatSummary(3, 2, 0)).toContain('3 catches in 2 files');
  });

  it('flags blocking catches when present', () => {
    const out = formatSummary(5, 3, 2);
    expect(out).toContain('5 catches in 3 files');
    expect(out).toContain('2 blocking');
  });

  it('does not mention "blocking" when zero block catches', () => {
    const out = formatSummary(2, 1, 0);
    expect(out).not.toContain('blocking');
  });
});
