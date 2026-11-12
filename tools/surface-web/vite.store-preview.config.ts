import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Standalone presentation artifact; the production Surface entry remains separate.
export default defineConfig({
  root: fileURLToPath(new URL('../../system/composition/web/store-preview', import.meta.url)),
  base: './',
  appType: 'mpa',
  build: {
    outDir: fileURLToPath(new URL('../../out/store-preview', import.meta.url)),
    emptyOutDir: true,
  },
});
