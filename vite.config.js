import { rmSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function cleanGeneratedAssets() {
  return {
    name: "repo-canvas-clean-generated-assets",
    apply: "build",
    buildStart() {
      rmSync(new URL("./public/assets/", import.meta.url), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  root: "frontend",
  plugins: [cleanGeneratedAssets(), react()],
  build: {
    outDir: "../public",
    emptyOutDir: false,
    sourcemap: false,
  },
  server: {
    port: 4174,
    proxy: {
      "/api": "http://127.0.0.1:4173",
    },
  },
});
