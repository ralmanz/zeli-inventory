import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // en desarrollo, la API corre aparte: npm run dev:server
    proxy: { '/api': 'http://localhost:8787' },
  },
  preview: {
    allowedHosts: ['inventory.lab.zeli.lat', 'zeli-inventory-production.up.railway.app'],
  },
})
