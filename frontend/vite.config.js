import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.DEV_PORT) || 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/socket.io': {
        target: BACKEND_URL,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
