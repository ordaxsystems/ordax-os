import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { dependencyStylesPlugin } from './dependency-styles.mjs';
export default defineConfig({
  root: fileURLToPath(new URL('../../system/composition/web', import.meta.url)),
  base: './',
  appType: 'mpa',
  plugins: [dependencyStylesPlugin(), react(), tailwindcss()],
  resolve: { alias: { '@ordax-brand': fileURLToPath(new URL('../../system/surface/ui/brand', import.meta.url)), '@': fileURLToPath(new URL('../../system/surface/workspace', import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL('../../out/web-ui', import.meta.url)), emptyOutDir: true }
});
