import { describe, expect, it } from 'vitest';

import {
  extractSql,
  getCalleeName,
  tagMatches,
} from '../src/extract.js';

// V1.4 — extract helpers tests.
//
// extract.ts is pure — no ESLint, no parser. We hand-construct
// minimal ESTree-shaped mock nodes and assert on the produced SQL
// string + placeholder mapping. The real plugin runs against
// ESLint's parsed AST, but the contract this module satisfies is
// purely structural.

interface MockTemplateLiteral {
  type: 'TemplateLiteral';
  quasis: Array<{ type: 'TemplateElement'; value: { cooked: string; raw: string } }>;
  expressions: Array<{ __label: string }>;
}

function mockTemplate(
  quasis: string[],
  expressions: string[],
): MockTemplateLiteral {
  return {
    type: 'TemplateLiteral',
    quasis: quasis.map((q) => ({
      type: 'TemplateElement',
      value: { cooked: q, raw: q },
    })),
    expressions: expressions.map((e) => ({ __label: e })),
  };
}

const getExprSource = (n: unknown) => (n as { __label: string }).__label;

describe('extractSql', () => {
  it('extracts a literal with no substitutions verbatim', () => {
    const t = mockTemplate(['SELECT * FROM users'], []);
    const r = extractSql(t as never, getExprSource);
    expect(r.sql).toBe('SELECT * FROM users');
    expect(r.mapping.size).toBe(0);
  });

  it('replaces ${expr} with $1', () => {
    const t = mockTemplate(
      ['SELECT * FROM users WHERE id = ', ''],
      ['userId'],
    );
    const r = extractSql(t as never, getExprSource);
    expect(r.sql).toBe('SELECT * FROM users WHERE id = $1');
    expect(r.mapping.get('$1')).toBe('userId');
  });

  it('numbers multiple expressions $1, $2, $3', () => {
    const t = mockTemplate(
      ['SELECT * FROM users WHERE a = ', ' AND b = ', ' AND c = ', ''],
      ['x', 'y', 'z'],
    );
    const r = extractSql(t as never, getExprSource);
    expect(r.sql).toBe(
      'SELECT * FROM users WHERE a = $1 AND b = $2 AND c = $3',
    );
    expect(r.mapping.get('$1')).toBe('x');
    expect(r.mapping.get('$2')).toBe('y');
    expect(r.mapping.get('$3')).toBe('z');
  });

  it('handles 10+ substitutions correctly', () => {
    const quasis = Array.from({ length: 11 }, () => 'a');
    const expressions = Array.from({ length: 10 }, (_, i) => `e${i}`);
    const t = mockTemplate(quasis, expressions);
    const r = extractSql(t as never, getExprSource);
    expect(r.mapping.get('$10')).toBe('e9');
    expect(r.sql).toContain('$10');
  });
});

describe('getCalleeName', () => {
  it('returns the name of an Identifier callee', () => {
    expect(getCalleeName({ type: 'Identifier', name: 'sql' })).toBe('sql');
  });

  it('returns dotted form for a MemberExpression', () => {
    expect(
      getCalleeName({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'db' },
        property: { type: 'Identifier', name: 'query' },
        computed: false,
      }),
    ).toBe('db.query');
  });

  it('returns dotted form for nested member expressions', () => {
    expect(
      getCalleeName({
        type: 'MemberExpression',
        object: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'a' },
          property: { type: 'Identifier', name: 'b' },
          computed: false,
        },
        property: { type: 'Identifier', name: 'query' },
        computed: false,
      }),
    ).toBe('a.b.query');
  });

  it('handles this.query', () => {
    expect(
      getCalleeName({
        type: 'MemberExpression',
        object: { type: 'ThisExpression' },
        property: { type: 'Identifier', name: 'query' },
        computed: false,
      }),
    ).toBe('this.query');
  });

  it('returns null for computed member expressions (db[name])', () => {
    expect(
      getCalleeName({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'db' },
        property: { type: 'Identifier', name: 'query' },
        computed: true,
      }),
    ).toBe(null);
  });

  it('returns null for nodes that have no name', () => {
    expect(getCalleeName(null)).toBe(null);
    expect(getCalleeName(undefined)).toBe(null);
    expect(getCalleeName({ type: 'Literal' })).toBe(null);
  });
});

describe('tagMatches', () => {
  it('matches an Identifier tag in the configured list', () => {
    expect(tagMatches({ type: 'Identifier', name: 'sql' }, ['sql'])).toBe(true);
    expect(
      tagMatches({ type: 'Identifier', name: 'sql' }, ['raw', 'sql']),
    ).toBe(true);
  });

  it('does not match an Identifier tag not in the list', () => {
    expect(tagMatches({ type: 'Identifier', name: 'html' }, ['sql'])).toBe(
      false,
    );
  });

  it('matches a MemberExpression tag (db.sql)', () => {
    expect(
      tagMatches(
        {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'db' },
          property: { type: 'Identifier', name: 'sql' },
          computed: false,
        },
        ['db.sql'],
      ),
    ).toBe(true);
  });

  it('returns false for shapes without a name', () => {
    expect(tagMatches({ type: 'CallExpression' }, ['sql'])).toBe(false);
  });
});
