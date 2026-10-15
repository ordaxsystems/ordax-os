import { resolve } from "node:path";
import { defineConfig } from "vite";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);

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
