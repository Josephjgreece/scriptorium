import { defineConfig } from "vite";

// Tauri expects a fixed dev-server port and must not have the screen cleared.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022" },
});
