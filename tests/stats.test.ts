import { describe, it, expect } from 'vitest'
import { aggregate, summarize, bucketKey } from '../app/utils/stats'
import type { DayRecord } from '../app/services/types'

const mk = (date: string, gross: number, km: number, costs: [string, string, number][]): DayRecord => {
  const lines = costs.map(([categoryId, name, amount]) => ({ categoryId, name, rate: km ? amount / km : 0, amount }))
  const totalCost = lines.reduce((s, c) => s + c.amount, 0)
  return { date, km, services: [{ amount: gross }], costs: lines, gross, totalCost, net: gross - totalCost }
}

const days = [
  mk('2026-09-30', 100000, 50, [['c1', 'Gasolina', 5000], ['c2', 'Servicio', 2000]]),
  mk('2026-10-01', 200000, 100, [['c1', 'Gasolina', 10000], ['c2', 'Servicio', 4000]]),
  mk('2026-10-02', 150000, 80, [['c1', 'Gasolina', 8000], ['c2', 'Servicio', 3000], ['c3', 'Seguro', 800]]),
]

describe('bucketKey', () => {
  it('trunca la fecha según la granularidad', () => {
    expect(bucketKey('2026-10-14', 'day')).toBe('2026-10-14')
    expect(bucketKey('2026-10-14', 'month')).toBe('2026-10')
    expect(bucketKey('2026-10-14', 'year')).toBe('2026')
  })
})

describe('aggregate', () => {
  it('agrupa por mes y suma todo', () => {
    const b = aggregate(days, 'month')
    expect(b.map(x => x.key)).toEqual(['2026-09', '2026-10'])
    const oct = b[1]!
    expect(oct.gross).toBe(350000)
    expect(oct.km).toBe(180)
    expect(oct.days).toBe(2)
    expect(oct.totalCost).toBe(25800)
    expect(oct.net).toBe(324200)
    expect(oct.costs.get('c1')).toEqual({ name: 'Gasolina', amount: 18000 })
    expect(oct.costs.get('c3')).toEqual({ name: 'Seguro', amount: 800 })
  })

  it('devuelve cronológico ascendente por día', () => {
    expect(aggregate(days, 'day').map(x => x.key)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('lista vacía → sin buckets', () => {
    expect(aggregate([], 'month')).toEqual([])
  })
})

describe('summarize', () => {
  it('totales, promedio diario, neto por km y mejor día', () => {
    const s = summarize(days)
    expect(s.gross).toBe(450000)
    expect(s.net).toBe(450000 - 32800)
    expect(s.days).toBe(3)
    expect(s.avgNet).toBeCloseTo((450000 - 32800) / 3, 5)
    expect(s.netPerKm).toBeCloseTo((450000 - 32800) / 230, 5)
    expect(s.best?.date).toBe('2026-10-01')
  })

  it('sin datos no divide por cero', () => {
    const s = summarize([])
    expect(s.avgNet).toBe(0)
    expect(s.netPerKm).toBe(0)
    expect(s.best).toBeNull()
  })
})
