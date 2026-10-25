import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { nativeEmulatorPlugin } from "./native-host.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const surfaceWorkspace = fileURLToPath(new URL("../../system/surface/workspace", import.meta.url));
const surfaceBrand = fileURLToPath(new URL("../../system/surface/ui/brand", import.meta.url));
const stateDirectory = process.env.ORDAX_EMULATOR_STATE_DIR ?? resolve(repoRoot, "out/windows-emulator-state");
const accountGatewayOrigin = readFileSync(resolve(repoRoot, "system/services/account/gateway-base-url"), "utf8").trim();

const emulatorHost = process.env.ORDAX_EMULATOR_HOST ?? "127.0.0.1";

export default defineConfig({
  root: repoRoot,
  appType: "mpa",
  // Never write optimized deps into a packaged, read-only Program Files runtime.
  cacheDir: resolve(stateDirectory, "vite-cache"),
  plugins: [nativeEmulatorPlugin(stateDirectory, { desktopHost: process.env.ORDAX_DESKTOP_HOST === "1", accountGatewayOrigin })],
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      "@ordax-brand": surfaceBrand,
      "@": surfaceWorkspace,
    },
  },
  server: {
    host: emulatorHost,
    port: Number.parseInt(process.env.ORDAX_EMULATOR_PORT ?? "4202", 10),
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
  },
});
