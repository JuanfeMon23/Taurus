// https://nuxt.com/docs/api/configuration/nuxt-config
// TAURUS_TARGET=native desactiva el service worker para el APK (Capacitor); la web lo usa.
const native = process.env.TAURUS_TARGET === 'native'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,
  modules: ['@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      // Client ID de OAuth (público por diseño). El client_secret NO se usa ni se incluye en la app.
      googleClientId: process.env.NUXT_PUBLIC_GOOGLE_CLIENT_ID
        ?? '921319021536-huj7hhki8nm54i1d1dtqe1c8q2n3j7b9.apps.googleusercontent.com',
    },
  },
  app: {
    head: {
      title: 'Taurus',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0f1115' },
        { name: 'description', content: 'Control de ganancias netas, costos por km y caja.' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    },
  },
  pwa: {
    disable: native,
    registerType: 'autoUpdate',
    manifest: {
      name: 'Taurus',
      short_name: 'Taurus',
      description: 'Control de ganancias netas, costos por km y caja.',
      lang: 'es',
      theme_color: '#0f1115',
      background_color: '#0f1115',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      icons: [
        { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      // 200.html/404.html se precachean como "/200" y "/404"; sin URLs limpias en el host, la instalación del SW falla.
      globIgnores: ['**/200.html', '**/404.html'],
    },
    client: { installPrompt: true },
  },
})
