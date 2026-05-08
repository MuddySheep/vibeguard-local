import { describe, expect, it } from 'vitest';

import { reconstructTemplate } from '../src/reconstruct.js';

// V1.4 — reconstruct helper tests.
//
// reconstructTemplate replaces `$1`, `$2`, ... with `${expr1}`,
// `${expr2}` ... using the mapping captured during extraction.

describe('reconstructTemplate', () => {
  it('returns input verbatim when there are no $N placeholders', () => {
    const r = reconstructTemplate(
      'SELECT * FROM users WHERE id = 1',
      new Map(),
    );
    expect(r).toBe('SELECT * FROM users WHERE id = 1');
  });

  it('re-inlines a single $1 placeholder', () => {
    const r = reconstructTemplate(
      'SELECT * FROM users WHERE id = $1',
      new Map([['$1', 'userId']]),
    );
    expect(r).toBe('SELECT * FROM users WHERE id = ${userId}');
  });

  it('re-inlines multiple placeholders in order', () => {
    const r = reconstructTemplate(
      'WHERE a = $1 AND b = $2 AND c = $3',
      new Map([
        ['$1', 'x'],
        ['$2', 'y'],
        ['$3', 'z'],
      ]),
    );
    expect(r).toBe('WHERE a = ${x} AND b = ${y} AND c = ${z}');
  });

  it('disambiguates $1 from $10 (no greedy regex bleed)', () => {
    const r = reconstructTemplate(
      'a = $1, j = $10',
      new Map([
        ['$1', 'one'],
        ['$10', 'ten'],
      ]),
    );
    expect(r).toBe('a = ${one}, j = ${ten}');
  });

  it('leaves orphan placeholders (not in mapping) alone', () => {
    const r = reconstructTemplate(
      'SELECT $1, $99 FROM t',
      new Map([['$1', 'one']]),
    );
    expect(r).toBe('SELECT ${one}, $99 FROM t');
  });

  it('re-inlines complex expression source verbatim', () => {
    const r = reconstructTemplate(
      'SELECT * FROM users WHERE id = $1',
      new Map([['$1', 'getUserId(req.params.id)']]),
    );
    expect(r).toBe(
      'SELECT * FROM users WHERE id = ${getUserId(req.params.id)}',
    );
  });
});
