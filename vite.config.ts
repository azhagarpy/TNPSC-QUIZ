import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'குரூப் 4 வினாடி வினா · Group 4 Quiz Battle',
        short_name: 'G4 Quiz',
        description: 'TNPSC Group 4 practice that feels like a game: solo sets, daily challenge and coin rooms with friends.',
        lang: 'ta',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFF8EE',
        theme_color: '#B0124F',
        categories: ['education', 'games'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Solo practice · தனிப் பயிற்சி', url: '/solo' },
          { name: 'Join a room · அறையில் சேர', url: '/join' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The 3D engine is downloaded only by phones that can run it, then cached at runtime.
        // The sample pack is only used in demo mode (no Supabase configured).
        globIgnores: ['**/Scenes3D-*.js', '**/samplePack-*.js'],
        // Web push handlers (show notification, open the right screen on tap).
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/assets/Scenes3D-'),
            handler: 'CacheFirst',
            options: { cacheName: 'g4-3d', expiration: { maxEntries: 6 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'CacheFirst',
            options: { cacheName: 'g4-images', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
  },
});
