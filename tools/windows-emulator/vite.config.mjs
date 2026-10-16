import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createWindowsMvpNativeHostPlugin } from "./native-host.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaceWorkspace = fileURLToPath(new URL("../../system/surface/workspace", import.meta.url));
const surfaceBrand = fileURLToPath(new URL("../../system/surface/ui/brand", import.meta.url));

export default defineConfig({
  root: repoRoot,
  appType: "mpa",
  plugins: [createWindowsMvpNativeHostPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@ordax-brand": surfaceBrand,
      "@": surfaceWorkspace,
    },
  },
  server: {
    warmup: {
      clientFiles: ["./system/**/*.mjs"],
    },
    host: "127.0.0.1",
    port: 4202,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
