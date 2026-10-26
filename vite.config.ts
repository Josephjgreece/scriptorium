import { defineConfig } from "vite";

// Tauri expects a fixed dev-server port and must not have the screen cleared.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // The app loads its code from disk, not over a network, so one larger file is fine.
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
