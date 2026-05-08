// Browser-friendly libpg-query bootstrap.
//
// Why this file exists:
//
// libpg-query@17 ships an Emscripten-built WASM module. Its
// `wasm/index.js` calls the Emscripten factory with NO config —
// the loader then derives the .wasm URL from `import.meta.url`.
//
// Vite bundles libpg-query/wasm/index.js + libpg-query.js into the
// playground's main JS bundle, so `import.meta.url` becomes the
// playground bundle URL — and the WASM file isn't copied next to
// it. The browser fetches `assets/libpg-query.wasm` → 404 → the
// SPA's index.html is served as a fallback → the loader sees
// `<!doctype html>` instead of WASM magic bytes and aborts.
//
// Fix: import the WASM as a Vite asset (`?url` returns a hashed
// URL pointing at the emitted artifact) and pass a `locateFile`
// callback into the Emscripten factory so it fetches from the
// right place.
//
// We re-implement the small `parseSync` surface from
// libpg-query/wasm/index.js so we don't have to wedge the
// upstream module's auto-init out of the way.

// Vite asset import — emits libpg-query.wasm into the build output
// and provides its hashed URL at runtime. Works in both dev and
// production builds.
import wasmUrl from 'libpg-query/wasm/libpg-query.wasm?url';

// Direct factory import. The default export is the Emscripten
// module factory; calling it with config returns a ready-to-use
// module after the WASM is fetched + compiled.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import PgQueryModule from 'libpg-query/wasm/libpg-query.js';

interface WasmModule {
  readonly _malloc: (n: number) => number;
  readonly _free: (ptr: number) => void;
  readonly _wasm_parse_query_raw: (ptr: number) => number;
  readonly _wasm_free_parse_result: (ptr: number) => void;
  readonly lengthBytesUTF8: (s: string) => number;
  readonly stringToUTF8: (s: string, ptr: number, max: number) => void;
  readonly UTF8ToString: (ptr: number) => string;
  readonly getValue: (ptr: number, type: string) => number;
}

export interface SqlErrorDetails {
  readonly message: string;
  readonly cursorPosition: number;
  readonly fileName?: string;
  readonly functionName?: string;
  readonly lineNumber?: number;
  readonly context?: string;
}

/**
 * Mirrors libpg-query's exported `SqlError`. Re-implemented here
 * so we don't pull in the upstream module's auto-init path.
 */
export class SqlError extends Error {
  readonly sqlDetails?: SqlErrorDetails;
  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = 'SqlError';
    if (details) this.sqlDetails = details;
  }
}

let wasmModule: WasmModule | null = null;
let initPromise: Promise<void> | null = null;

/**
 * One-time async bootstrap of the WASM parser. Idempotent.
 * Subsequent calls await the same in-flight promise.
 */
export function loadModule(): Promise<void> {
  if (wasmModule !== null) return Promise.resolve();
  if (initPromise !== null) return initPromise;

  // Pass `locateFile` so Emscripten fetches OUR Vite-emitted asset
  // instead of guessing relative to the bundled JS.
  initPromise = (PgQueryModule as unknown as (
    config: { locateFile: (path: string) => string },
  ) => Promise<WasmModule>)({
    locateFile: (path: string) => {
      // Emscripten asks for "libpg-query.wasm"; redirect to our URL.
      // For any other auxiliary file (none expected for this WASM
      // build), fall back to the requested path so we don't hide
      // a real bug behind a one-line override.
      if (path.endsWith('.wasm')) return wasmUrl;
      return path;
    },
  })
    .then((module) => {
      wasmModule = module;
    })
    .catch((err) => {
      initPromise = null;
      throw err;
    });

  return initPromise;
}

function ensureLoaded(): WasmModule {
  if (wasmModule === null) {
    throw new Error('WASM module not initialized. Call loadModule() first.');
  }
  return wasmModule;
}

/**
 * Synchronously parse a SQL string. Requires `loadModule()` to
 * have resolved. On parse failure throws an `SqlError` with the
 * details the SDK's wrapper expects.
 */
export function parseSync(query: string): unknown {
  if (query === null || query === undefined) {
    throw new Error('Query cannot be null or undefined');
  }
  if (typeof query !== 'string') {
    throw new TypeError(`Query must be a string, got ${typeof query}`);
  }
  const m = ensureLoaded();
  const len = m.lengthBytesUTF8(query) + 1;
  const queryPtr = m._malloc(len);
  if (!queryPtr) throw new Error('Failed to allocate memory for query');
  let resultPtr = 0;

  try {
    m.stringToUTF8(query, queryPtr, len);
    resultPtr = m._wasm_parse_query_raw(queryPtr);
    if (!resultPtr) throw new Error('Failed to allocate memory for parse result');

    // PgQueryParseResult: { char* parse_tree; char* stderr_buffer; PgQueryError* error; }
    const parseTreePtr = m.getValue(resultPtr, 'i32');
    const errorPtr = m.getValue(resultPtr + 8, 'i32');

    if (errorPtr) {
      // PgQueryError: { char* message; char* funcname; char* filename;
      //                 int lineno; int cursorpos; char* context; }
      const messagePtr = m.getValue(errorPtr, 'i32');
      const funcnamePtr = m.getValue(errorPtr + 4, 'i32');
      const filenamePtr = m.getValue(errorPtr + 8, 'i32');
      const lineno = m.getValue(errorPtr + 12, 'i32');
      const cursorpos = m.getValue(errorPtr + 16, 'i32');
      const contextPtr = m.getValue(errorPtr + 20, 'i32');

      const message = messagePtr ? m.UTF8ToString(messagePtr) : 'Unknown error';
      const details: SqlErrorDetails = {
        message,
        cursorPosition: cursorpos > 0 ? cursorpos - 1 : 0,
        ...(filenamePtr ? { fileName: m.UTF8ToString(filenamePtr) } : {}),
        ...(funcnamePtr ? { functionName: m.UTF8ToString(funcnamePtr) } : {}),
        ...(lineno > 0 ? { lineNumber: lineno } : {}),
        ...(contextPtr ? { context: m.UTF8ToString(contextPtr) } : {}),
      };
      throw new SqlError(message, details);
    }

    if (!parseTreePtr) throw new Error('Parse result is null');
    const parseTreeJson = m.UTF8ToString(parseTreePtr);
    return JSON.parse(parseTreeJson);
  } finally {
    m._free(queryPtr);
    if (resultPtr) m._wasm_free_parse_result(resultPtr);
  }
}
