import './CodeBlock.css';

import type { CSSProperties } from 'react';

export interface CodeBlockProps {
  /** Code text to render. Whitespace is preserved verbatim. */
  readonly code: string;
  /**
   * Language label shown at the top of the block. Purely
   * decorative; does NOT trigger any syntax highlighting (host-
   * agnostic by design — pair with a real highlighter at the app
   * level if needed).
   */
  readonly language?: string;
  /** Optional className appended to the root. */
  readonly className?: string;
  /** Inline style overrides on the root. */
  readonly style?: CSSProperties;
}

/**
 * Plain monospaced code block with the design-system aesthetic.
 * Host-agnostic: receives the code as a string and emits a
 * `<pre><code>` pair. Apps that need syntax-highlighted code
 * should use a dedicated component (CodeMirror, Shiki, etc.) on
 * top of the same token system.
 */
export function CodeBlock({ code, language, className, style }: CodeBlockProps) {
  const cls = className ? `vg-code-block ${className}` : 'vg-code-block';
  return (
    <div className={cls} {...(style ? { style } : {})}>
      {language ? (
        <header className="vg-code-block__head">
          <span className="vg-code-block__lang">{language}</span>
        </header>
      ) : null}
      <pre className="vg-code-block__pre">
        <code className="vg-code-block__code">{code}</code>
      </pre>
    </div>
  );
}
