// Playground entry point. Bootstraps React, the design system,
// and (asynchronously) the WASM parser.

import '@vibeguard-dev/ui/tokens.css';
import '@vibeguard-dev/ui/global.css';
import '@vibeguard-dev/ui/styles.css';
import './main.css';

import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Could not find #root in index.html');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
