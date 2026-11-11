import { describe, expect, it } from 'vitest'
import { areaGradient, escapeHtml, legendTop, smoothLine, tooltipCard, valueAxis, withAlpha } from '../app/utils/chartOptions'
import { numberCompact } from '../app/utils/format'

describe('numberCompact', () => {
  it('abrevia sin símbolo para ejes', () => {
    expect(numberCompact(850)).toBe('850')
    expect(numberCompact(350000)).toBe('350 k')
    expect(numberCompact(1200000)).toBe('1,2 M')
    expect(numberCompact(-2500)).toBe('-2,5 k')
  })
  it('no redondea a enteros los valores pequeños (evita ejes «0 0 0 1 1 1»)', () => {
    expect(numberCompact(0)).toBe('0')
    expect(numberCompact(0.5)).toBe('0,5')
    expect(numberCompact(0.2)).toBe('0,2')
  })
})

describe('withAlpha / areaGradient', () => {
  it('convierte hex de 6 y 3 dígitos a rgba y deja otros formatos igual', () => {
    expect(withAlpha('#ffb020', 0.5)).toBe('rgba(255, 176, 32, 0.5)')
    expect(withAlpha('#fff', 0.2)).toBe('rgba(255, 255, 255, 0.2)')
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)')
  })
  it('el degradado va del color translúcido a transparente', () => {
    const gradient = areaGradient('#3987e5', 0.3)
    expect(gradient.colorStops[0]!.color).toBe('rgba(57, 135, 229, 0.3)')
    expect(gradient.colorStops[1]!.color).toBe('rgba(57, 135, 229, 0)')
  })
})

describe('tooltipCard', () => {
  it('incluye título, filas con marcador, valores y pie', () => {
    const html = tooltipCard({ title: 'Mar', rows: [{ color: '#3987e5', label: 'Efectivo', value: '$ 1.000' }], footer: { label: 'Total', value: '$ 1.000' } })
    expect(html).toContain('Mar')
    expect(html).toContain('background:#3987e5')
    expect(html).toContain('Efectivo')
    expect(html).toContain('Total')
  })
  it('escapa el texto y descarta colores no seguros', () => {
    const html = tooltipCard({ title: '<img onerror=x>', rows: [{ color: 'red;background:url(x)', label: '<b>', value: '"1"' }] })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('url(x)')
    expect(html).toContain('&lt;b&gt;')
    expect(escapeHtml('a&b')).toBe('a&amp;b')
  })
})

const colors = {
  text: '#fff', textSecondary: '#ccc', muted: '#999', border: '#333', borderStrong: '#555', surface: '#111', surfaceRaised: '#222',
  accent: '#ffb020', positive: '#0f0', negative: '#f00', info: '#00f', series: ['#111'], font: 'sans-serif',
}

describe('valueAxis / legendTop / smoothLine', () => {
  it('el eje de valores no genera marcas fraccionarias', () => {
    expect(valueAxis(colors).minInterval).toBe(1)
  })
  it('la leyenda no se pagina', () => {
    expect(legendTop(colors).type).toBe('plain')
  })
  it('la línea discontinua no lleva área y la sólida sí; ambas dejan huecos en null', () => {
    const solid = smoothLine(colors, 'Neto', [1, null, 3], '#ffb020')
    const dashed = smoothLine(colors, 'Neto tras gastos', [1, null, 3], '#ccc', { dashed: true })
    expect('areaStyle' in solid).toBe(true)
    expect('areaStyle' in dashed).toBe(false)
    expect(dashed.lineStyle.type).toEqual([7, 5])
    expect(solid.connectNulls).toBe(false)
  })
})
