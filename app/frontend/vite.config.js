import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    // Output to app/dist/ so serve.cjs can find it
    outDir: "../dist",
    emptyOutDir: true,
  },

  clearScreen: false,
  // Dev server runs on 5173 and forwards API/media requests to serve.cjs (default port 1420).
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: Object.fromEntries(
      ["/api", "/sdapi", "/v1", "/tts-outputs", "/audio-outputs", "/video-outputs", "/transcriptions"].map((prefix) => [
        prefix,
        { target: `http://127.0.0.1:${process.env.STUDIO_PORT || 1420}`, changeOrigin: false },
      ]),
    ),
  },
}));
