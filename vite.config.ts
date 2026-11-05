import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // No sourcemap in the published build: it added 779 KB to dist and nothing reads it.
  build: { outDir: 'dist', sourcemap: false },
});
