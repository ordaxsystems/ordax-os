// Canonical Windows Desktop compiler policy, owned by the shell and not by
// any OS source commit. CI invokes it from the OS checkout, while the installed
// Desktop copies it to a disposable config path in its exact staged OS root.
// Both paths compile the same OS+OS-pinned Surface, never a Desktop UI fork.
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = resolve(process.cwd());
if (!existsSync(resolve(repoRoot, "system/composition/native/index.html")))
  throw new Error("Missing canonical Native source in staged OS checkout");

export default {
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
};
