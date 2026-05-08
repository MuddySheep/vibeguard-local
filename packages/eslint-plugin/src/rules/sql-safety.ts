// `vibeguard/sql-safety` — the headline ESLint rule.
//
// Visits TaggedTemplateExpression and CallExpression nodes; if the
// tag (or callee) matches the configured list, extracts the SQL,
// runs the VibeGuard analyzer, and reports every catch as an ESLint
// diagnostic. For catches whose rules have fixers, attaches an
// ESLint `fix` callback that runs applyFixes() and writes the new
// template-literal source back through ESLint's fixer API.
//
// Sync-init: the plugin's index.ts top-level-awaits `init()` once at
// module load, so by the time this rule's `create()` runs the
// libpg-query parser is ready. ESLint rules are sync; analyze() is
// sync after init().
//
// Source-position handling: when the visitor sees a TemplateLiteral,
// we report the diagnostic at the literal's range (or the parent
// TaggedTemplateExpression range if applicable). The ESLint fixer's
// `replaceText(node, ...)` handles the source-range replacement.

import type { Rule } from 'eslint';
import type {
  CallExpression,
  Node,
  TaggedTemplateExpression,
  TemplateLiteral,
} from 'estree';

import {
  analyze,
  applyFixes,
  RULE_REGISTRY,
} from '@vibeguard-dev/local';
import type { AnalyzeOptions } from '@vibeguard-dev/local';

import { extractSql, getCalleeName, tagMatches } from '../extract.js';
import { reconstructTemplate } from '../reconstruct.js';

/**
 * Plugin options for `vibeguard/sql-safety`.
 *
 *   tags             — tag names that mark a template literal as SQL.
 *                      Default: ['sql']
 *   callExpressions  — function/member names whose first arg (when a
 *                      template literal) is treated as SQL.
 *                      Default: [] (empty — opt-in)
 *   rules            — per-rule overrides forwarded to the analyzer
 *                      and fix-runner. Same shape as the SDK's
 *                      AnalyzeOptions.rules. Default: {}
 */
export interface SqlSafetyOptions {
  readonly tags?: readonly string[];
  readonly callExpressions?: readonly string[];
  readonly rules?: AnalyzeOptions['rules'];
}

const DEFAULT_TAGS = ['sql'] as const;

// Pre-compute which catch codes have a fixer in the registry. Used
// to decide whether to attach a `fix` callback to each report.
const FIXABLE_CODES: ReadonlySet<string> = new Set(
  RULE_REGISTRY.filter((e) => e.fixer !== undefined).map((e) => e.code),
);

export const sqlSafetyRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Run VibeGuard SQL safety analysis on tagged template literals and matching call expressions.',
      url: 'https://github.com/MuddySheep/vibeguard-local/tree/main/packages/eslint-plugin#vibeguardsql-safety',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          callExpressions: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
          rules: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                enabled: { type: 'boolean' },
              },
            },
          },
        },
      },
    ],
    messages: {
      catchFired: '[{{code}}] {{title}}: {{detail}}',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const opts = (context.options[0] ?? {}) as SqlSafetyOptions;
    const tags = opts.tags ?? DEFAULT_TAGS;
    const callExpressions = opts.callExpressions ?? [];
    const analyzeOptions: AnalyzeOptions =
      opts.rules !== undefined ? { rules: opts.rules } : {};

    const sourceCode = context.sourceCode;

    function getExprSource(node: Node): string {
      return sourceCode.getText(node as Parameters<typeof sourceCode.getText>[0]);
    }

    function reportTemplate(
      template: TemplateLiteral,
      reportTarget: Node,
    ): void {
      const { sql, mapping } = extractSql(template, getExprSource);

      // Run analyzer to get catches; we attach autofix only when a
      // catch's rule has a fixer in the registry.
      const result = analyze(sql, analyzeOptions);
      if (result.parseError) {
        // Parse-failed SQL inside a tagged template is rare in
        // practice; silently skip — we don't want to surface every
        // sql`SELECT --partial query` work-in-progress as a lint error.
        return;
      }

      for (const c of result.catches) {
        const isFixable = FIXABLE_CODES.has(c.code);
        const reportPayload: Rule.ReportDescriptor = {
          node: reportTarget,
          messageId: 'catchFired',
          data: {
            code: c.code,
            title: c.title,
            detail: c.detail,
          },
        };
        if (isFixable) {
          reportPayload.fix = (fixer) => buildFix(fixer, template, sql, mapping);
        }
        context.report(reportPayload);
      }
    }

    function buildFix(
      fixer: Rule.RuleFixer,
      template: TemplateLiteral,
      originalSql: string,
      mapping: ReadonlyMap<string, string>,
    ): Rule.Fix | null {
      const fixResult = applyFixes(originalSql, analyzeOptions);
      if (!fixResult.changed) return null;

      // Re-inline `${expr}` for each `$N` that survived the fix.
      const newInner = reconstructTemplate(fixResult.sql, mapping);
      const replacement = '`' + newInner + '`';

      // Replace the template literal's source range. For bare
      // template literals this is the literal itself; for tagged
      // template expressions we replace the quasi only (the tag
      // identifier stays untouched).
      return fixer.replaceText(
        template as Parameters<typeof fixer.replaceText>[0],
        replacement,
      );
    }

    return {
      TaggedTemplateExpression(node: TaggedTemplateExpression): void {
        if (!tagMatches(node.tag, tags)) return;
        reportTemplate(node.quasi, node);
      },
      CallExpression(node: CallExpression): void {
        if (callExpressions.length === 0) return;
        const calleeName = getCalleeName(node.callee);
        if (calleeName === null) return;
        if (!callExpressions.includes(calleeName)) return;
        const firstArg = node.arguments[0];
        if (!firstArg || firstArg.type !== 'TemplateLiteral') return;
        reportTemplate(firstArg, firstArg);
      },
    };
  },
};
