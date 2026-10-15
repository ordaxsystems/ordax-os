import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

export default defineConfig({
  root: repoRoot,
  server: {
    host: "127.0.0.1",
    port: 4202,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
