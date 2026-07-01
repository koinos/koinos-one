import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  publicDir: 'build/docs',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true
  }
})
