import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2}'],
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
    })
  ],
  server: { port: 5173 }
});
