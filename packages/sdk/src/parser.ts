// libpg-query wrapper.
//
// Why this layer exists:
//   1. libpg-query is async-init (`loadModule()` returns a Promise that
//      compiles a multi-MB WASM blob). We expose a single `init()` for
//      consumers to await once at startup. After init, `parseQuery` is
//      genuinely synchronous on every call.
//   2. libpg-query throws on invalid SQL. The SDK contract is "give me
//      SQL, get back a result" — never throw. This wrapper catches
//      libpg-query throws and surfaces them as structured `ParseError`
//      values via `AnalysisResult.parseError`.
//   3. libpg-query is a peer dependency. If consumers forget to install
//      it, the require/import fails. We catch that case at the wrapper
//      boundary and surface a clean, actionable error message.
//
// Note on `unknown` return type:
//   libpg-query's AST shape is large and version-coupled. We type the
//   returned AST as `unknown` here so substrate / rule code does the
//   narrowing where it matters; this keeps SDK majors decoupled from
//   parser-version updates.

import { createRequire } from 'node:module';

import type { ParseError } from './types.js';

interface LibpgQuery {
  /** Returns a Promise that resolves once the WASM module is ready. */
  loadModule(): Promise<void>;
  /**
   * Synchronously parse a SQL string. Requires `loadModule()` to have
   * resolved first. Throws SqlError on parse failure.
   */
  parseSync(sql: string): unknown;
}

interface SqlErrorLike {
  readonly message?: string;
  readonly sqlDetails?: { readonly cursorPosition?: number };
}

/**
 * Successful or failed parse. Never throws; on failure, `error` is set
 * and `ast` is a stub with an empty `stmts` array so substrate/rule
 * code can treat the AST uniformly without null checks.
 */
export interface ParseQueryResult {
  readonly ast: unknown;
  readonly error?: ParseError;
}

let cachedLib: LibpgQuery | undefined;
let initialized = false;

/**
 * Lazily resolve the peer-dependency `libpg-query`. We use `require`
 * (via `createRequire`) so a missing peer surfaces with a clean message
 * the first time the user calls `init()` or `parseQuery()`, rather
 * than as a load-time stack trace pointing at our internals.
 *
 * Throws (does not return parseError) when the peer is genuinely
 * absent — that's a configuration error, not an analysis-input error.
 */
function loadLibpgQuery(): LibpgQuery {
  if (cachedLib) return cachedLib;
  try {
    const req = createRequire(import.meta.url);
    cachedLib = req('libpg-query') as LibpgQuery;
    return cachedLib;
  } catch {
    throw new Error(
      '@vibeguard-dev/local requires libpg-query as a peer dependency. ' +
        'Install it with: npm install libpg-query',
    );
  }
}

/**
 * One-time async initialization of the underlying WASM parser.
 * Consumers MUST `await init()` once at startup before calling
 * `analyze()` (or `parseQuery()` directly). Calling more than once is
 * safe and cheap — subsequent calls resolve instantly via the
 * library's own cache.
 *
 * @throws if the `libpg-query` peer dependency is not installed
 */
export async function init(): Promise<void> {
  const lib = loadLibpgQuery();
  await lib.loadModule();
  initialized = true;
}

/**
 * Parse a SQL string using libpg-query. Synchronous, throw-safe.
 *
 * Returns `{ ast, error? }`:
 *   - `ast` is the libpg-query parse tree (or a `{ stmts: [] }` stub
 *     on failure)
 *   - `error` is a structured `ParseError` if parsing failed; absent on success
 *
 * Pre-conditions:
 *   - `init()` must have resolved at least once. If it hasn't, returns
 *     `{ ast: { stmts: [] }, error: { message: '...not initialized...' } }`
 *     — never throws.
 *
 * Edge cases:
 *   - Empty input → structured error (no parser invocation)
 *   - Whitespace-only input → structured error
 *   - Invalid SQL → libpg-query's SqlError caught and converted
 */
export function parseQuery(sql: string): ParseQueryResult {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    return {
      ast: { stmts: [] },
      error: { message: 'empty SQL input' },
    };
  }
  if (!initialized) {
    return {
      ast: { stmts: [] },
      error: {
        message:
          '@vibeguard-dev/local: parser not initialized — call `await init()` once at startup before `analyze()`',
      },
    };
  }
  // loadLibpgQuery is cheap on the cache-hit path (subsequent calls).
  // We don't gate `parseQuery` on a fresh require — `init` already did.
  const lib = cachedLib!;
  try {
    const ast = lib.parseSync(sql);
    return { ast };
  } catch (err) {
    const e = err as SqlErrorLike;
    const cursor = e.sqlDetails?.cursorPosition;
    return {
      ast: { stmts: [] },
      error: {
        message: e.message ?? 'parse failed',
        ...(typeof cursor === 'number' ? { cursor } : {}),
      },
    };
  }
}

/**
 * Test-only: reset internal state so unit tests can verify
 * pre-init behavior. Not part of the public API.
 *
 * @internal
 */
export function __resetForTests(): void {
  cachedLib = undefined;
  initialized = false;
}
