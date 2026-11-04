import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': el SW nuevo queda en espera; solo se activa si el usuario lo acepta.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'ScoreBasket',
        short_name: 'ScoreBasket',
        description: 'Control de marcador de baloncesto, con o sin conexión.',
        lang: 'es',
        start_url: '/matches',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#090a0f',
        theme_color: '#090a0f',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Cualquier navegación de la SPA (/matches, /teams, /live/:id) sirve index.html precacheado.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Nunca skipWaiting/clientsClaim automáticos: no se interrumpe un partido en curso.
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
})
