type Theme = 'dark' | 'light'

const KEY = 'taurus-theme'
const theme = ref<Theme>('dark')
let ready = false

function apply(t: Theme) {
  theme.value = t
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0a0c11' : '#f4f6fb')
}

/** Tema claro/oscuro: respeta el guardado, si no el del sistema. */
export function useTheme() {
  if (!ready && import.meta.client) {
    ready = true
    let saved: string | null = null
    try { saved = localStorage.getItem(KEY) } catch { /* sin storage */ }
    const system: Theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    apply(saved === 'light' || saved === 'dark' ? saved : system)
  }
  function toggle() {
    const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
    apply(next)
    try { localStorage.setItem(KEY, next) } catch { /* sin storage */ }
  }
  return { theme, toggle }
}
