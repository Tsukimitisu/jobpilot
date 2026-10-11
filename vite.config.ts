import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'JobPilot', short_name: 'JobPilot', description: 'Your private job-search workspace.',
      lang: 'en', start_url: '/dashboard', scope: '/', display: 'standalone',
      theme_color: '#246344', background_color: '#f6f8f6',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      globIgnores: ['**/icons.svg'],
      runtimeCaching: [],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [/^\/(?:dashboard|jobs|applications|settings|profile|resumes|login)?$/],
      ignoreURLParametersMatching: [],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: false,
    },
    devOptions: { enabled: false },
  })],
})
