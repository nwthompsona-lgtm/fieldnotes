import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// FieldReport — the ONE app (Phase 13a): management surfaces (review/send/delivery/
// settings) plus the offline-first capture flow at /capture. The service worker
// precaches the whole shell so the installed app boots offline; /api/* is NEVER
// cached (NetworkOnly) — uploads must always hit the live server.
export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      includeAssets: [
        'apple-touch-icon.png',
        'favicon-32.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        name: 'FieldReport',
        short_name: 'FieldReport',
        description: 'Walk the site. We write the report.',
        // The installed home-screen icon opens INTO the capture flow — that's the
        // mobile-first surface; management routes are one tap away on the same origin.
        start_url: '/capture',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#2b54e0',
        background_color: '#EEF2F7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the full app shell (built JS/CSS/HTML/icons) for offline boot.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        // Hard rule: never let the SW intercept/cache API traffic.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5181,
    host: true,
  },
});
