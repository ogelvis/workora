import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Keep the browser's Host header so the API's same-origin check matches the Origin header.
      // Vite's string shorthand enables changeOrigin, which makes every POST fail with 403.
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
})
