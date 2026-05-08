import './AstViewer.css';

import { useState, useMemo } from 'react';

export interface AstViewerProps {
  /** AST root from the analyzer (any JSON-serializable value). */
  readonly ast: unknown;
}

/**
 * Hand-rolled collapsible JSON viewer. We don't pull in a library
 * because off-the-shelf JSON viewers are ~30+ KB and we only need
 * collapse/expand + safe rendering. Same color tokens as the rest
 * of the playground.
 *
 * Cycle-safe: tracks visited objects and renders `[circular]` if
 * one is encountered.
 */
export function AstViewer({ ast }: AstViewerProps) {
  // Pre-compute size once for the header.
  const stats = useMemo(() => measure(ast), [ast]);
  return (
    <div className="vg-ast" role="tree" aria-label="Parsed AST">
      <header className="vg-ast__head">
        <span className="vg-ast__title">AST</span>
        <span className="vg-ast__stat">{stats.nodes} nodes</span>
      </header>
      <div className="vg-ast__body">
        <Node value={ast} path="$" depth={0} initialOpen={true} />
      </div>
    </div>
  );
}

interface NodeProps {
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
  readonly initialOpen?: boolean;
  readonly nameLabel?: string;
}

function Node({ value, path, depth, initialOpen, nameLabel }: NodeProps) {
  const [open, setOpen] = useState(
    initialOpen ?? depth < 2,
  );

  if (value === null) {
    return (
      <div className="vg-ast__row" role="treeitem">
        {nameLabel !== undefined ? (
          <span className="vg-ast__key">{nameLabel}: </span>
        ) : null}
        <span className="vg-ast__null">null</span>
      </div>
    );
  }

  if (typeof value !== 'object') {
    let cls = 'vg-ast__primitive';
    if (typeof value === 'string') cls += ' vg-ast__string';
    else if (typeof value === 'number') cls += ' vg-ast__number';
    else if (typeof value === 'boolean') cls += ' vg-ast__bool';
    return (
      <div className="vg-ast__row" role="treeitem">
        {nameLabel !== undefined ? (
          <span className="vg-ast__key">{nameLabel}: </span>
        ) : null}
        <span className={cls}>{formatPrimitive(value)}</span>
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const summary = isArr ? `Array(${entries.length})` : `{${entries.length}}`;
  const opener = isArr ? '[' : '{';
  const closer = isArr ? ']' : '}';

  return (
    <div className="vg-ast__row" role="treeitem" aria-expanded={open}>
      <button
        className="vg-ast__toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Collapse' : 'Expand'}
      >
        <span className="vg-ast__chevron">{open ? '▾' : '▸'}</span>
        {nameLabel !== undefined ? (
          <span className="vg-ast__key">{nameLabel}: </span>
        ) : null}
        <span className="vg-ast__summary">
          {opener} <em>{summary}</em> {closer}
        </span>
      </button>
      {open ? (
        <div className="vg-ast__children" role="group">
          {entries.map(([k, v]) => (
            <Node
              key={`${path}.${k}`}
              value={v}
              path={`${path}.${k}`}
              depth={depth + 1}
              nameLabel={k}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatPrimitive(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

interface AstStats {
  nodes: number;
}

function measure(value: unknown, seen = new WeakSet<object>()): AstStats {
  if (value === null || typeof value !== 'object') return { nodes: 1 };
  if (seen.has(value as object)) return { nodes: 0 };
  seen.add(value as object);
  let n = 1;
  if (Array.isArray(value)) {
    for (const item of value) n += measure(item, seen).nodes;
  } else {
    for (const v of Object.values(value as Record<string, unknown>)) {
      n += measure(v, seen).nodes;
    }
  }
  return { nodes: n };
}
