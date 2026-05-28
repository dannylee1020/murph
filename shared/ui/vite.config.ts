import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const product = process.env.MURPH_UI_PRODUCT === 'personal' ? 'personal' : 'team';
const productDir = product === 'personal' ? 'murph-personal' : 'murph-team';

export default defineConfig({
  root: path.resolve(here, '..', '..', productDir, 'ui'),
  publicDir: path.resolve(here, 'public'),
  build: {
    outDir: path.resolve(here, '..', '..', 'dist', productDir, 'ui'),
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
