import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { nativeEmulatorPlugin } from "./native-host.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaceWorkspace = fileURLToPath(new URL("../../system/surface/workspace", import.meta.url));
const surfaceBrand = fileURLToPath(new URL("../../system/surface/ui/brand", import.meta.url));

const emulatorHost = process.env.ORDAX_EMULATOR_HOST ?? "127.0.0.1";

export default defineConfig({
  root: repoRoot,
  appType: "mpa",
  plugins: [nativeEmulatorPlugin(resolve(repoRoot, "out/windows-emulator-state"))],
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      "@ordax-brand": surfaceBrand,
      "@": surfaceWorkspace,
    },
  },
  server: {
    host: emulatorHost,
    port: 4202,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
