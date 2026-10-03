import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev only: point the proxy at another server (e.g. DARKROOM_API_PORT=3002)
const apiPort = process.env.DARKROOM_API_PORT || '3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Keep the browser's Host so the server's same-origin check sees localhost:5173 on both sides
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      '/ws': {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
      },
    },
  },
});
