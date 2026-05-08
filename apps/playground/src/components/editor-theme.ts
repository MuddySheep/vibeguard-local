// CodeMirror 6 themes for the VibeGuard playground.
//
// We hand-roll thin themes that bind to the design tokens defined
// in @vibeguard-dev/ui's tokens.css. Anything not explicitly
// overridden uses CodeMirror's default, which is fine.

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const baseTheme = (vars: { bg: string; ink: string; sel: string; cursor: string }) =>
  EditorView.theme(
    {
      '&': {
        backgroundColor: vars.bg,
        color: vars.ink,
      },
      '.cm-content': { caretColor: vars.cursor },
      '&.cm-focused .cm-cursor': { borderLeftColor: vars.cursor },
      '.cm-selectionBackground, ::selection': { backgroundColor: vars.sel },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: vars.sel,
      },
    },
    { dark: vars.bg === 'var(--vg-bg-1)' },
  );

const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#b9ff66' },
  { tag: [t.string, t.special(t.string)], color: '#ffd166' },
  { tag: t.number, color: '#7cc7ff' },
  { tag: t.operator, color: '#c4c4c8' },
  { tag: t.comment, color: '#84848c', fontStyle: 'italic' },
  { tag: t.variableName, color: '#f4f4f5' },
  { tag: t.typeName, color: '#7cc7ff' },
  { tag: t.bool, color: '#b9ff66' },
  { tag: t.null, color: '#ff6b6b' },
]);

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#2d6b1f' },
  { tag: [t.string, t.special(t.string)], color: '#b76e00' },
  { tag: t.number, color: '#1864ab' },
  { tag: t.operator, color: '#2a2a30' },
  { tag: t.comment, color: '#5a5a62', fontStyle: 'italic' },
  { tag: t.variableName, color: '#0a0a0c' },
  { tag: t.typeName, color: '#1864ab' },
  { tag: t.bool, color: '#2d6b1f' },
  { tag: t.null, color: '#c92a2a' },
]);

export const vgDarkTheme = [
  baseTheme({
    bg: 'var(--vg-bg-1)',
    ink: 'var(--vg-ink)',
    sel: 'rgba(185, 255, 102, 0.18)',
    cursor: '#b9ff66',
  }),
  syntaxHighlighting(darkHighlight),
];

export const vgLightTheme = [
  baseTheme({
    bg: 'var(--vg-bg-1)',
    ink: 'var(--vg-ink)',
    sel: 'rgba(45, 107, 31, 0.18)',
    cursor: '#2d6b1f',
  }),
  syntaxHighlighting(lightHighlight),
];
