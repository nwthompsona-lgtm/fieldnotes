import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// FieldReport CAPTURE — Vite + React + PWA.
// The service worker precaches the app shell so the installed app loads fully
// offline. /api/* is NEVER cached (NetworkOnly) — uploads must always hit the
// live server and we never want a stale upload response served from cache.
export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-512-maskable.png',
      ],
      manifest: {
        name: 'FieldReport',
        short_name: 'FieldReport',
        description: 'Offline-first jobsite observation capture.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0F3D2E',
        background_color: '#0F3D2E',
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
    port: 5180,
    host: true,
  },
});
