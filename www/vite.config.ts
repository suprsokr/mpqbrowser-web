import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
  },
  // wow-mpq-web locates its .wasm file relative to import.meta.url.
  // If Vite pre-bundles it into node_modules/.vite/deps/, the wasm URL
  // resolves to a non-existent path and the dev server returns the SPA
  // fallback HTML. Excluding it keeps the package in its original location.
  optimizeDeps: {
    exclude: ['wow-mpq-web'],
  },
});
