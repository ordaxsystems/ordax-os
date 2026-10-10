import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "/assets/account/",
  build: {
    outDir: "../candidate-dist",
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "",
    cssCodeSplit: false,
    manifest: true,
    target: "es2022",
  },
});
