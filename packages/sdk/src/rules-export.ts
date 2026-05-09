// Browser-safe subset of the SDK's public surface.
//
// The main barrel (src/index.ts) re-exports `init` and `parseQuery`
// from parser.ts, which uses Node's `createRequire` to load
// libpg-query. That makes the main barrel Node-only — bundling it
// for the browser fails with "createRequire is not exported".
//
// This file re-exports the parts that DON'T need libpg-query:
// rule definitions, the runner, and the public types. Browser
// consumers (the V1.5+ playground) feed an externally-parsed AST
// to `runRules` and skip the SDK's parser entirely.
//
// Surface is a strict subset of `@vibeguard-dev/local`. Same names,
// same shapes — no fork.
//
// Available as the `@vibeguard-dev/local/rules` subpath import.

export { runRules } from './run-rules.js';
export type { RunRulesOptions } from './run-rules.js';

export { RULES, RULE_REGISTRY } from './rules/index.js';
export type { RuleEntry } from './rules/index.js';

export type {
  Catch,
  AnalysisResult,
  Severity,
  ThreatCategory,
  Rule,
  Fixer,
  ParseError,
} from './types.js';
