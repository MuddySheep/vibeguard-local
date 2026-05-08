import './App.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CatchCard, // imported for type-only inference; not used directly here
  Mesh,
  Grain,
  Nav,
  NavCta,
  ThemeToggle,
  type Theme,
} from '@vibeguard-dev/ui';

import { Editor } from './components/Editor.js';
import { ResultsPanel } from './components/ResultsPanel.js';
import { AstViewer } from './components/AstViewer.js';
import { SampleGallery } from './components/SampleGallery.js';
import { SAMPLES, type Sample } from './samples.js';
import { analyze, init, isReady } from './analyzer.js';
import { decodeFromHash, encodeToHash } from './share.js';

// Suppress unused-import lint for the type-only side. CatchCard
// is consumed indirectly via ResultsPanel; keeping it imported here
// makes the dependency graph more obvious to readers.
void CatchCard;

const INITIAL_SQL =
  '-- VibeGuard playground.\n' +
  '-- Paste SQL here, or pick a sample below.\n' +
  '\n' +
  "SELECT id FROM users WHERE active = NULL;\n";

interface RuleOverrides {
  readonly [code: string]: { readonly enabled?: boolean };
}

export function App() {
  const [ready, setReady] = useState<boolean>(isReady());
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark',
  );
  const [sql, setSql] = useState<string>(INITIAL_SQL);
  const [activeSample, setActiveSample] = useState<string | undefined>(undefined);
  const [showAst, setShowAst] = useState<boolean>(false);
  const [shareCopied, setShareCopied] = useState<boolean>(false);
  const [overrides, setOverrides] = useState<RuleOverrides>({});

  // Hydrate SQL from URL hash on first load.
  const hydratedFromHash = useRef(false);
  useEffect(() => {
    if (hydratedFromHash.current) return;
    hydratedFromHash.current = true;
    const decoded = decodeFromHash(window.location.hash);
    if (decoded !== null) setSql(decoded);
  }, []);

  // Bootstrap WASM parser once.
  useEffect(() => {
    let alive = true;
    init()
      .then(() => {
        if (alive) setReady(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to init libpg-query', err);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Run analysis whenever SQL or overrides change.
  const result = useMemo(() => {
    if (!ready) {
      return {
        catches: [],
        ast: undefined as unknown,
        loading: true,
        idle: false,
        parseError: undefined as { message: string } | undefined,
      };
    }
    const onlyComments = sql.trim().length === 0 || isOnlyComments(sql);
    if (onlyComments) {
      return {
        catches: [],
        ast: undefined as unknown,
        loading: false,
        idle: true,
        parseError: undefined,
      };
    }
    const r = analyze(sql, { rules: overrides, includeAst: showAst });
    return {
      catches: r.catches,
      ast: r.ast,
      loading: false,
      idle: false,
      parseError: r.parseError,
    };
  }, [sql, overrides, ready, showAst]);

  const handlePickSample = useCallback((sample: Sample) => {
    setSql(sample.sql);
    setActiveSample(sample.code);
    if (sample.forceEnable) {
      setOverrides((prev) => ({
        ...prev,
        [sample.forceEnable!]: { enabled: true },
      }));
    }
  }, []);

  const handleSqlChange = useCallback((next: string) => {
    setSql(next);
    setActiveSample(undefined);
  }, []);

  const handleShare = useCallback(async () => {
    const hash = encodeToHash(sql);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    window.history.replaceState(null, '', hash);
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      // clipboard API unavailable — at least the URL is updated.
    }
  }, [sql]);

  return (
    <div className="vg-app" data-theme={theme}>
      <Mesh />
      <Grain />

      <header className="vg-app__header">
        <Nav
          brand={
            <span className="vg-app__brand">
              <span className="vg-app__brand-mark" aria-hidden="true" />
              <span className="vg-app__brand-name">VibeGuard</span>
              <span className="vg-app__brand-sub">playground</span>
            </span>
          }
        >
          <NavCta
            href="https://github.com/MuddySheep/vibeguard-local"
            external
            variant="ghost"
          >
            GitHub
          </NavCta>
          <NavCta
            href="https://www.npmjs.com/package/@vibeguard-dev/local"
            external
            variant="ghost"
          >
            npm
          </NavCta>
          <ThemeToggle onChange={(t) => setTheme(t)} />
        </Nav>
      </header>

      <main className="vg-app__main">
        <SampleGallery
          samples={SAMPLES}
          {...(activeSample !== undefined ? { activeCode: activeSample } : {})}
          onPick={handlePickSample}
        />

        <div className="vg-app__split">
          <section className="vg-app__col vg-app__col--editor">
            <header className="vg-app__col-head">
              <span className="vg-app__col-label">SQL</span>
              <div className="vg-app__col-actions">
                <button
                  type="button"
                  className="vg-app__chip-btn"
                  onClick={() => setShowAst((v) => !v)}
                  aria-pressed={showAst}
                  title="Toggle AST view"
                >
                  {showAst ? 'hide AST' : 'show AST'}
                </button>
                <button
                  type="button"
                  className="vg-app__chip-btn vg-app__chip-btn--primary"
                  onClick={handleShare}
                  title="Copy a shareable URL of this SQL"
                >
                  {shareCopied ? 'copied!' : 'share'}
                </button>
              </div>
            </header>
            <div className="vg-app__editor-wrap">
              <Editor value={sql} onChange={handleSqlChange} theme={theme} />
            </div>
          </section>

          <section className="vg-app__col vg-app__col--results">
            <header className="vg-app__col-head">
              <span className="vg-app__col-label">analysis</span>
            </header>
            <ResultsPanel
              catches={result.catches}
              {...(result.parseError ? { parseError: result.parseError } : {})}
              loading={result.loading}
              idle={result.idle}
            />
          </section>
        </div>

        {showAst && result.ast !== undefined ? (
          <section className="vg-app__ast-section">
            <AstViewer ast={result.ast} />
          </section>
        ) : null}
      </main>

      <footer className="vg-app__footer">
        <p>
          Runs entirely in your browser — your SQL never leaves your machine.
        </p>
        <p className="vg-app__footer-hint">
          Powered by{' '}
          <a
            href="https://www.npmjs.com/package/@vibeguard-dev/local"
            target="_blank"
            rel="noopener noreferrer"
          >
            @vibeguard-dev/local
          </a>{' '}
          + libpg-query (WASM).
        </p>
      </footer>
    </div>
  );
}

function isOnlyComments(sql: string): boolean {
  // Strip line comments and block comments; if nothing's left,
  // consider it "only comments / whitespace".
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  return stripped.length === 0;
}
