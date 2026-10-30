// Precompile the unchanged canonical Native entrypoint into a bounded static graph.
// This is an artifact of system/composition/native, not a Desktop fork of Surface.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export default defineConfig({
  root: repoRoot,
  appType: "mpa",
  publicDir: false,
  base: "/__ordax/desktop-assets/",
  resolve: {
    alias: {
      "@ordax-brand": resolve(repoRoot,"system/surface/ui/brand"),
      "@": resolve(repoRoot,"system/surface/workspace"),
    },
  },
  build: {
    outDir: resolve(repoRoot,"out/windows-desktop-native"),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: resolve(repoRoot,"system/composition/native/index.html"),
    },
  },
});
