import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
