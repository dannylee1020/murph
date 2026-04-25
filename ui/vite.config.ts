import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:5173'
    }
  }
});
