import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { cpSync, mkdirSync } from 'node:fs';
import type { Plugin } from 'vite';

function copyPdfJsAssets(): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    closeBundle() {
      const sourceRoot = path.resolve(__dirname, '../../node_modules/pdfjs-dist');
      const targetRoot = path.resolve(__dirname, 'dist/pdfjs');
      mkdirSync(targetRoot, { recursive: true });
      for (const directory of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
        cpSync(path.join(sourceRoot, directory), path.join(targetRoot, directory), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPdfJsAssets()],
  root: '.',
  base: '/viewer/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
