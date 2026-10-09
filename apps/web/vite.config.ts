import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';

export default defineConfig({
  plugins: [react()],
  // Shown in the footer
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    // `pnpm dev` runs the Worker (wrangler dev) on 8787; Vite proxies API calls to it
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
