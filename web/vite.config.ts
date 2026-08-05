import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3456", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3456", changeOrigin: true },
      "/ws": { target: "http://127.0.0.1:3456", changeOrigin: true, ws: true },
    },
  },
})
