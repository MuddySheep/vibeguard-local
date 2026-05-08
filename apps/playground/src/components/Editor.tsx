import './Editor.css';

import { useMemo, useEffect, useRef } from 'react';
import { sql as sqlLang } from '@codemirror/lang-sql';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import CodeMirror from '@uiw/react-codemirror';

import { vgDarkTheme, vgLightTheme } from './editor-theme.js';

export interface EditorProps {
  /** Current editor value. */
  readonly value: string;
  /** Called whenever the user edits the SQL. */
  readonly onChange: (next: string) => void;
  /** Theme — driven by the playground's overall dark/light state. */
  readonly theme: 'dark' | 'light';
  /** Whether the editor should be read-only. */
  readonly readOnly?: boolean;
}

/**
 * SQL editor wrapper. Wraps CodeMirror 6 with:
 *   - SQL language + syntax highlighting (Postgres dialect)
 *   - line numbers
 *   - active-line highlight
 *   - the playground's dark/light theme
 */
export function Editor({ value, onChange, theme, readOnly }: EditorProps) {
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo<Extension[]>(
    () => [
      sqlLang(),
      lineNumbers(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      EditorView.theme(
        {
          '&': { fontSize: '13.5px', height: '100%' },
          '.cm-scroller': {
            fontFamily: "var(--vg-mono, ui-monospace, monospace)",
          },
          '.cm-content': { padding: '14px 0' },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--vg-ink-4)',
          },
          '.cm-activeLine': { background: 'transparent' },
          '.cm-activeLineGutter': {
            background: 'transparent',
            color: 'var(--vg-ink-3)',
          },
        },
        { dark: theme === 'dark' },
      ),
    ],
    [theme],
  );

  // Static state-extension toggle for read-only mode.
  const stateExt = useMemo<Extension[]>(
    () => (readOnly === true ? [EditorState.readOnly.of(true)] : []),
    [readOnly],
  );

  // Persist viewRef so future features (e.g. gutter markers) can
  // reach in. Unused in V1 but harmless.
  useEffect(() => {
    return () => {
      viewRef.current = null;
    };
  }, []);

  return (
    <div className="vg-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[...extensions, ...stateExt]}
        theme={theme === 'dark' ? vgDarkTheme : vgLightTheme}
        height="100%"
        basicSetup={{
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
          lineNumbers: false,
        }}
        onCreateEditor={(v) => {
          viewRef.current = v;
        }}
      />
    </div>
  );
}
