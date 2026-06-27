import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// FieldReport REVIEW + ADMIN — Vite + React SPA.
// Pure client app: it only talks to the FieldReport server over the documented
// HTTP API (base = VITE_API_BASE). No service worker, no caching of /api traffic.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5181,
    host: true,
  },
});
