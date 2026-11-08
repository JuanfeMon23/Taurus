/** Paleta de gráficas tomada de los tokens CSS del proyecto; se recalcula al cambiar el tema claro/oscuro. */
export interface ChartPalette {
  text: string
  textSecondary: string
  muted: string
  border: string
  surface: string
  surfaceRaised: string
  accent: string
  positive: string
  negative: string
  info: string
  series: string[]
  font: string
}

const SERIES_TOKENS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8']

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function useChartTheme() {
  const { theme } = useTheme()
  const palette = computed<ChartPalette>(() => {
    void theme.value // dependencia: recalcula al alternar el tema
    const styles = getComputedStyle(document.documentElement)
    const token = (name: string) => styles.getPropertyValue(name).trim()
    return {
      text: token('--text'),
      textSecondary: token('--text-2'),
      muted: token('--muted'),
      border: token('--border'),
      surface: token('--surface'),
      surfaceRaised: token('--surface-2'),
      accent: token('--accent'),
      positive: token('--pos'),
      negative: token('--neg'),
      info: token('--info'),
      series: SERIES_TOKENS.map(token),
      font: getComputedStyle(document.body).fontFamily,
    }
  })
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Ajustes comunes: tipografía, animación y estilo del tooltip. */
  const baseOption = computed(() => ({
    animation: !reducedMotion,
    textStyle: { fontFamily: palette.value.font, color: palette.value.textSecondary },
    tooltip: {
      backgroundColor: palette.value.surface,
      borderColor: palette.value.border,
      borderWidth: 1,
      textStyle: { color: palette.value.text, fontFamily: palette.value.font, fontSize: 12 },
      extraCssText: 'border-radius:12px;box-shadow:var(--shadow);',
    },
  }))
  return { palette, baseOption }
}
