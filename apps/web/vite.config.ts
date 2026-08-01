import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The dashboard imports the API's zod contract directly, so a renamed field is a
      // compile error here rather than an `undefined` in the browser.
      '@oc/api/contract': r('../api/src/contract.ts'),
      '@oc/core/types': r('../../packages/core/src/types.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5173,
    // Dev-only: the SPA is served by Express in production (P6.8), so this proxy exists
    // purely so `npm run web:dev` talks to the same routes without a CORS shim.
    proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
  build: { outDir: r('./dist'), emptyOutDir: true },
});
