/** Bloques de opciones de ECharts compartidos por todas las gráficas (sin E/S): ejes, leyenda, degradados y tarjeta de tooltip. */
import { numberCompact } from './format'

/** Paleta de gráficas tomada de los tokens CSS del proyecto. */
export interface ChartPalette {
  text: string
  textSecondary: string
  muted: string
  border: string
  borderStrong: string
  surface: string
  surfaceRaised: string
  accent: string
  positive: string
  negative: string
  info: string
  series: string[]
  font: string
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]+$/

/** `#rrggbb` o `#rgb` → `rgba(...)` con la opacidad dada; cualquier otro formato se devuelve igual. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return color
  const hex = match[1]!.length === 3 ? match[1]!.split('').map(digit => digit + digit).join('') : match[1]!
  const [red, green, blue] = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

/** Degradado vertical sutil bajo una línea: del color (translúcido) a transparente. */
export function areaGradient(color: string, topAlpha = 0.22) {
  return {
    type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [{ offset: 0, color: withAlpha(color, topAlpha) }, { offset: 1, color: withAlpha(color, 0) }],
  }
}

export interface TooltipRow {
  label: string
  value?: string
  /** Color del marcador de serie (punto redondo). */
  color?: string
}

export interface TooltipCardInput {
  title?: string
  subtitle?: string
  rows?: TooltipRow[]
  footer?: Omit<TooltipRow, 'color'>
}

function tooltipRowHtml(row: TooltipRow, emphasis: boolean): string {
  const marker = row.color && SAFE_COLOR.test(row.color)
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${row.color};margin-right:8px;flex:none"></span>`
    : ''
  const value = row.value === undefined ? '' : `<b style="font-variant-numeric:tabular-nums;color:var(--text);${emphasis ? 'font-size:13px;' : ''}">${escapeHtml(row.value)}</b>`
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;line-height:20px;font-size:12px">`
    + `<span style="display:flex;align-items:center;color:var(--text-2)">${marker}${escapeHtml(row.label)}</span>${value}</div>`
}

/** HTML de la tarjeta del tooltip: título, subtítulo, filas con marcador de serie y un pie opcional (p. ej. total). Todo texto va escapado. */
export function tooltipCard(input: TooltipCardInput): string {
  const title = input.title ? `<div style="font-size:13px;font-weight:700;color:var(--text);line-height:18px">${escapeHtml(input.title)}</div>` : ''
  const subtitle = input.subtitle ? `<div style="font-size:12px;color:var(--muted);line-height:18px">${escapeHtml(input.subtitle)}</div>` : ''
  const header = title || subtitle ? `<div style="margin-bottom:${input.rows?.length ? 6 : 0}px">${title}${subtitle}</div>` : ''
  const rows = (input.rows ?? []).map(row => tooltipRowHtml(row, false)).join('')
  const footer = input.footer
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">${tooltipRowHtml(input.footer, true)}</div>`
    : ''
  return `<div style="min-width:150px">${header}${rows}${footer}</div>`
}

/** Estilo base del tooltip (la tarjeta se arma con `tooltipCard`). */
export function tooltipBase(colors: ChartPalette) {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: [10, 12],
    confine: true,
    transitionDuration: 0.12,
    textStyle: { color: colors.text, fontFamily: colors.font, fontSize: 12 },
    extraCssText: 'border-radius:12px;box-shadow:var(--shadow);',
  }
}

/** Puntero de eje en forma de banda tenue (barras y líneas por periodo). */
export function axisPointerBand(colors: ChartPalette) {
  return { type: 'shadow' as const, shadowStyle: { color: colors.accent, opacity: 0.08 } }
}

export function chartGrid(top: number, right = 12) {
  return { left: 4, right, top, bottom: 4, containLabel: true }
}

/** Eje de categorías limpio: sin línea (salvo `baseline`, p. ej. cuando hay negativos) ni marcas. */
export function categoryAxis(colors: ChartPalette, data: string[], options: { baseline?: boolean } = {}) {
  return {
    type: 'category' as const, data,
    axisLine: options.baseline ? { lineStyle: { color: colors.borderStrong } } : { show: false },
    axisTick: { show: false },
    axisLabel: { color: colors.muted, fontSize: 11, hideOverlap: true, margin: 10 },
  }
}

/** Eje de valores limpio: sin línea, cuadrícula punteada tenue y etiquetas compactas (1,2 M / 350 k). */
export function valueAxis(colors: ChartPalette, formatter: (amount: number) => string = numberCompact) {
  return {
    type: 'value' as const,
    // Montos en pesos: sin marcas fraccionarias (evita «0 0 0 1 1 1» cuando todo vale 0 o casi).
    minInterval: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: colors.muted, fontSize: 11, formatter },
    splitLine: { lineStyle: { color: colors.border, type: [4, 4] as number[] } },
  }
}

/** Leyenda compacta arriba a la izquierda con íconos redondeados; sin paginación (se parte en líneas: dejar ~56 px arriba en la rejilla). */
export function legendTop(colors: ChartPalette) {
  return {
    top: 0, left: 0, right: 0, type: 'plain' as const, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 14,
    inactiveColor: colors.muted,
    textStyle: { color: colors.textSecondary, fontSize: 12 },
  }
}

/**
 * Serie de línea suave; los puntos solo aparecen al pasar el cursor. Por defecto trazo sólido con área en degradado;
 * `dashed` da un trazo discontinuo sin área (para distinguir una segunda línea del mismo orden de magnitud).
 */
export function smoothLine(colors: ChartPalette, name: string, data: (number | null)[], color: string, options: { dashed?: boolean } = {}) {
  return {
    name, type: 'line' as const, data, color, smooth: 0.3, showSymbol: false, symbol: 'circle', symbolSize: 9, z: 5, connectNulls: false,
    lineStyle: { width: 2.5, cap: 'round' as const, join: 'round' as const, ...(options.dashed ? { type: [7, 5] as number[] } : {}) },
    itemStyle: { color, borderColor: colors.surface, borderWidth: 2 },
    ...(options.dashed ? {} : { areaStyle: { color: areaGradient(color) } }),
    emphasis: { focus: 'series' as const },
  }
}

/** Radio de esquinas para barras apiladas (solo arriba) o con extremo redondeado. */
export const BAR_RADIUS = 6

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return null
  const hex = match[1]!.length === 3 ? match[1]!.split('').map(digit => digit + digit).join('') : match[1]!
  return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number]
}

const relativeLuminance = ([red, green, blue]: [number, number, number]): number => {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map(channel => {
    const unit = channel / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue
}

/**
 * Celda de mapa de calor en escala secuencial de un tono: mezcla `base` sobre `surface` según `ratio` (0-1, intensidad
 * mínima 0,16 para que una celda con dato se distinga de una vacía). Devuelve el color de relleno y el del rótulo
 * (claro u oscuro, el de mayor contraste con el relleno ya mezclado) para que se lea en tema claro y oscuro.
 */
export function heatCell(base: string, surface: string, ratio: number): { fill: string; label: string } {
  const baseRgb = parseHex(base)
  const surfaceRgb = parseHex(surface)
  const intensity = 0.16 + 0.84 * Math.min(1, Math.max(0, ratio))
  if (!baseRgb || !surfaceRgb) return { fill: withAlpha(base, intensity), label: '' }
  const mixed = baseRgb.map((channel, index) => Math.round(channel * intensity + surfaceRgb[index]! * (1 - intensity))) as [number, number, number]
  const luminance = relativeLuminance(mixed)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  return { fill: `rgb(${mixed.join(', ')})`, label: contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#111111' }
}
