// Module declarations for assets and untyped libpg-query internals.

// Vite's `?url` import returns the resolved asset URL as a string.
declare module '*?url' {
  const url: string;
  export default url;
}

// libpg-query's emscripten-generated loader has no shipped types.
// We treat it as `any` here; the wasm-loader.ts wrapper narrows
// the surface we actually use.
declare module 'libpg-query/wasm/libpg-query.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory: (config?: { locateFile?: (path: string) => string }) => Promise<any>;
  export default factory;
}
