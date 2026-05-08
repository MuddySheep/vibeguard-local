import { describe, expect, it } from 'vitest';

import { decodeFromHash, encodeToHash } from '../src/share.js';

describe('share — gzip+base64url URL hash', () => {
  it('round-trips a simple SQL string', () => {
    const sql = 'SELECT id FROM users WHERE active = NULL';
    const hash = encodeToHash(sql);
    expect(hash.startsWith('#s=')).toBe(true);
    expect(decodeFromHash(hash)).toBe(sql);
  });

  it('round-trips multi-line SQL with comments', () => {
    const sql =
      '-- pagination bug\nSELECT id\nFROM events\nLIMIT 10 OFFSET 20;\n';
    expect(decodeFromHash(encodeToHash(sql))).toBe(sql);
  });

  it('round-trips empty SQL', () => {
    expect(decodeFromHash(encodeToHash(''))).toBe('');
  });

  it('round-trips long SQL (>1KB)', () => {
    const sql = 'SELECT 1; '.repeat(200);
    expect(decodeFromHash(encodeToHash(sql))).toBe(sql);
  });

  it('round-trips unicode content (Cyrillic, emoji, CJK)', () => {
    const sql = "-- комментарий 🍎 日本語\nSELECT 'привет';\n";
    expect(decodeFromHash(encodeToHash(sql))).toBe(sql);
  });

  it('produces base64url (no +, /, =) so the URL is safe', () => {
    const hash = encodeToHash('SELECT 1');
    // Strip the leading '#s=' prefix
    const payload = hash.slice('#s='.length);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it('returns null for an empty hash', () => {
    expect(decodeFromHash('')).toBeNull();
    expect(decodeFromHash('#')).toBeNull();
  });

  it('returns null for a hash without the s parameter', () => {
    expect(decodeFromHash('#other=value')).toBeNull();
  });

  it('returns null for malformed payloads instead of throwing', () => {
    expect(decodeFromHash('#s=not-a-real-payload')).toBeNull();
  });

  it('accepts both # and bare forms', () => {
    const hash = encodeToHash('SELECT 1');
    const bare = hash.slice(1);
    expect(decodeFromHash(bare)).toBe('SELECT 1');
  });
});
