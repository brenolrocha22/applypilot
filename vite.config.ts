/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cada página HTML é uma entrada independente da extensão (MV3 não permite scripts inline).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        app: 'app.html',
        popup: 'popup.html',
        'demo-form': 'demo-form.html',
      },
      output: {
        // O worker do pdf.js é ESM (.mjs); servimos como .js para não depender do MIME de .mjs em páginas de extensão.
        assetFileNames: (info) => (info.name?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
