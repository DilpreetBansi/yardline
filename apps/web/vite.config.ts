import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Two builds from one codebase:
//   demo   - the API and Postgres (PGlite) run in a SharedWorker in the browser; static hosting.
//   server - talks to the Node server over HTTP with a session cookie.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? (process.env.DEMO_BASE ?? '/yardline/') : '/',
  plugins: [react()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist-server',
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: mode === 'server' ? { '/api': { target: 'http://localhost:8787', changeOrigin: false } } : undefined,
  },
}));
