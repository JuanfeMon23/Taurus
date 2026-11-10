// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],
  // Nada de CDN en runtime: sin fuentes remotas (se conserva system-ui) y los iconos Lucide de Nuxt UI van empaquetados en el cliente.
  ui: { fonts: false },
  icon: { provider: 'none', clientBundle: { scan: true } },
  // Misma clave que la preferencia que ya guardaba useTheme ('light' | 'dark'); sin guardado, el tema del sistema.
  colorMode: { preference: 'system', fallback: 'dark', storageKey: 'taurus-theme' },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      // Backend local de Taurus.
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000/api/v1',
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
