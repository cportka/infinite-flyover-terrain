import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) as well as from a custom domain.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
});
