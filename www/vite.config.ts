import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under the repository name path.
  base: process.env.GITHUB_PAGES ? '/mpqbrowser-web/' : '/',
  build: {
    target: 'es2022',
  },
  // `server.mjs` answers the archive listings and range reads; the dev server proxies to it so
  // `/api/archives` works at either origin.
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8088',
    },
  },
  // The wasm module locates its .wasm beside its own script; keep it out of the pre-bundle so the
  // URL resolves in dev as well as in a build.
  optimizeDeps: {
    exclude: ['benilla-web'],
  },
});
