export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'taurus-theme'
const theme = ref<Theme>('dark')
let ready = false

function apply(nextTheme: Theme) {
  theme.value = nextTheme
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(nextTheme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nextTheme === 'dark' ? '#0a0c11' : '#f4f6fb')
}

/** Tema claro/oscuro con clases `.light`/`.dark` en <html>: respeta el guardado (`taurus-theme`); sin guardado, el del sistema. */
export function useTheme() {
  if (!ready && import.meta.client) {
    ready = true
    let saved: string | null = null
    try { saved = localStorage.getItem(STORAGE_KEY) } catch { /* sin storage */ }
    const system: Theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    apply(saved === 'light' || saved === 'dark' ? saved : system)
  }
  function toggle() {
    const next: Theme = theme.value === 'dark' ? 'light' : 'dark'
    apply(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* sin storage */ }
  }
  return { theme, toggle }
}
