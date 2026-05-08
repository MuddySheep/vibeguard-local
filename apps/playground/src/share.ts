// Share-via-URL: gzip + base64-encode SQL into the URL hash so
// pasting the URL pre-fills the playground.
//
// Format: `#s=<base64url-encoded gzip>`. Base64URL avoids `+`/`/`/`=`
// which need escaping in URLs.
//
// Round-trip: `decodeFromHash(encodeToHash(sql)) === sql`.

import { deflate, inflate } from 'pako';

const HASH_KEY = 's';

/** Convert a Uint8Array to a base64url string. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Convert a base64url string to a Uint8Array. */
function fromBase64Url(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a SQL string into a `#s=…` hash fragment. */
export function encodeToHash(sql: string): string {
  const enc = new TextEncoder().encode(sql);
  const gz = deflate(enc, { level: 9 });
  return `#${HASH_KEY}=${toBase64Url(gz)}`;
}

/**
 * Decode a SQL string from a hash fragment. Accepts either the
 * raw `#s=…` form or the parameterless `s=…` (via location.hash).
 *
 * Returns `null` if no payload is found or it fails to decode.
 */
export function decodeFromHash(hash: string): string | null {
  if (!hash) return null;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const payload = params.get(HASH_KEY);
  if (payload === null) return null;
  try {
    const gz = fromBase64Url(payload);
    const buf = inflate(gz);
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}
