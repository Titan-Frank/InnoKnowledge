import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/viewer/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
