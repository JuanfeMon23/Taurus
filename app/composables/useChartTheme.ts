import { axisPointerBand, tooltipBase, type ChartPalette } from '../utils/chartOptions'

const SERIES_TOKENS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8']

/** Paleta de gráficas desde los tokens CSS (claro y oscuro) y opciones base comunes; se recalcula al alternar el tema. */
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
      borderStrong: token('--border-strong'),
      surface: token('--surface'),
      surfaceRaised: token('--surface-2'),
      accent: token('--accent-chart') || token('--accent'),
      positive: token('--pos'),
      negative: token('--neg'),
      info: token('--info'),
      series: SERIES_TOKENS.map(token),
      font: getComputedStyle(document.body).fontFamily,
    }
  })
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Ajustes comunes: tipografía, animación de entrada corta (apagada con prefers-reduced-motion) y tooltip como tarjeta. */
  const baseOption = computed(() => ({
    animation: !reducedMotion,
    animationDuration: 450,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: 250,
    textStyle: { fontFamily: palette.value.font, color: palette.value.textSecondary },
    tooltip: tooltipBase(palette.value),
  }))
  const axisPointer = computed(() => axisPointerBand(palette.value))
  return { palette, baseOption, axisPointer }
}
