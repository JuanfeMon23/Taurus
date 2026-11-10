export type Theme = 'dark' | 'light'

/** Tema claro/oscuro sobre el color-mode de Nuxt UI (guarda en `taurus-theme`; sin guardado, el del sistema). */
export function useTheme() {
  const colorMode = useColorMode()
  const theme = computed<Theme>(() => (colorMode.value === 'light' ? 'light' : 'dark'))

  if (import.meta.client) {
    watch(theme, (current) => {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'dark' ? '#0a0c11' : '#f4f6fb')
    }, { immediate: true })
  }

  function toggle() {
    colorMode.preference = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggle }
}
