import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  base: isProd ? '/app-stocks-mcf-psy/' : '/',
  plugins: [
    isProd ? VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/hhrxxfnxacymwwwpvazk\.supabase\.co\/rest\/v1\/mp_standard.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mp-standard', expiration: { maxAgeSeconds: 86400 * 7 } }
          }
        ]
      },
      manifest: {
        name: 'Stocks MCF + PSY',
        short_name: 'Stocks',
        description: 'Gestão de stocks MCF + PSY',
        theme_color: '#007AFF',
        background_color: '#f5f5f7',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    }) : null
  ].filter(Boolean),
  server: { port: parseInt(process.env.PORT || '5173'), host: true }
});
