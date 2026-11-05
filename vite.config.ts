import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), "VITE_").VITE_BASE_PATH || "/",
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
}));
