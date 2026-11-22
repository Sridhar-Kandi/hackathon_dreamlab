import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Python server (python -m mission_control) serves the build from ../web/app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: "../web/app", emptyOutDir: true, assetsDir: "static", chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8781",
      "/lab-media": "http://127.0.0.1:8781",
      "/ladder-media": "http://127.0.0.1:8781",
    },
  },
})
