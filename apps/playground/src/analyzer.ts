// Browser-side analyzer wiring.
//
// The SDK's `analyze()` uses Node's `createRequire` to load
// libpg-query. That doesn't work in browsers. Strategy here:
//
//   1. Import libpg-query directly via its ESM entry — its WASM
//      loader handles browser bootstrap on its own.
//   2. Call `parseSync(sql)` to get the AST.
//   3. Call the SDK's `runRules(ast, ...)` against the AST. The
//      SDK's runner is pure JS and runs in any environment.
//
// Result shape mirrors `AnalysisResult` from the SDK so consumer
// code (the playground UI) treats it the same way.

// Use OUR thin wrapper — it pre-locates the .wasm via a Vite asset
// import and avoids libpg-query/wasm/index.js's broken auto-init
// path under bundling. See wasm-loader.ts header for the long
// version.
import { loadModule, parseSync as libpgParseSync, SqlError } from './wasm-loader.js';

// Use the browser-safe subpath. The default export
// `@vibeguard-dev/local` pulls in parser.ts which uses Node's
// `createRequire` and is therefore Node-only.
import {
  RULES,
  RULE_REGISTRY,
  runRules,
  type Catch,
  type RuleEntry,
} from '@vibeguard-dev/local/rules';

export interface PlaygroundAnalysisResult {
  readonly catches: Catch[];
  readonly parseError?: { readonly message: string; readonly cursorPosition?: number };
  readonly ast?: unknown;
}

/**
 * Per-rule overrides forwarded by the playground UI. Same shape as
 * the SDK's `AnalyzeOptions.rules` — `{ [code]: { enabled?: bool } }`.
 */
export interface PlaygroundAnalyzeOptions {
  readonly rules?: { readonly [code: string]: { readonly enabled?: boolean } };
  /** If true, include the parsed AST in the result for the tree viewer. */
  readonly includeAst?: boolean;
}

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * One-time async bootstrap of the WASM parser. Idempotent.
 *
 * The first call kicks off WASM compilation; subsequent calls
 * await the same promise. Once resolved, `analyze()` is fully
 * synchronous (modulo the per-call parse).
 */
export function init(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = loadModule().then(() => {
    initialized = true;
  });
  return initPromise;
}

/**
 * Whether `init()` has resolved. Used by the UI to gate the
 * editor's Analyze button.
 */
export function isReady(): boolean {
  return initialized;
}

/**
 * Resolve the rule-set to run, honoring per-rule overrides.
 *
 * Mirrors the SDK's logic: default-on rules run unless explicitly
 * disabled; default-off rules run only if explicitly enabled. Match
 * is case-insensitive on catch codes.
 */
function selectRules(
  overrides: PlaygroundAnalyzeOptions['rules'],
): RuleEntry[] {
  if (overrides === undefined) {
    return RULE_REGISTRY.filter((e) => e.defaultEnabled);
  }
  const lcOverrides: Record<string, { enabled?: boolean }> = {};
  for (const [k, v] of Object.entries(overrides)) {
    lcOverrides[k.toLowerCase()] = v;
  }
  return RULE_REGISTRY.filter((entry) => {
    const o = lcOverrides[entry.code.toLowerCase()];
    if (o?.enabled === false) return false;
    if (o?.enabled === true) return true;
    return entry.defaultEnabled;
  });
}

/**
 * Run static analysis on a SQL string and (optionally) include
 * the AST in the result.
 *
 * Throws if `init()` hasn't been awaited yet (the libpg-query
 * loader will surface a meaningful error if called pre-init).
 */
export function analyze(
  sql: string,
  options: PlaygroundAnalyzeOptions = {},
): PlaygroundAnalysisResult {
  if (!initialized) {
    return {
      catches: [],
      parseError: {
        message: 'Analyzer is still loading — please wait a moment and retry.',
      },
    };
  }

  let ast: unknown;
  try {
    ast = libpgParseSync(sql);
  } catch (err) {
    if (err instanceof SqlError) {
      const cursor = err.sqlDetails?.cursorPosition;
      return {
        catches: [],
        parseError: {
          message: err.message,
          ...(cursor !== undefined ? { cursorPosition: cursor } : {}),
        },
      };
    }
    return {
      catches: [],
      parseError: {
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const entries = selectRules(options.rules);
  const rules = entries.map((e) => e.rule);
  const catches = runRules(ast, rules);

  // Always reuse the SDK's RULES export shape; satisfies tests
  // that compare against the in-Node analyze() output.
  void RULES;

  return {
    catches,
    ...(options.includeAst ? { ast } : {}),
  };
}
