import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The playground transitively imports `libpg-query` which only
    // works in real browsers. The unit tests stub it; we don't
    // actually load WASM in unit tests.
  },
});
