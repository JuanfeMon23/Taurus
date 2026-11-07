import { describe, it, expect } from 'vitest'
import { aggregate, summarize, bucketKey } from '../app/utils/stats'
import type { DayRecord } from '../app/services/types'

const buildDay = (date: string, gross: number, km: number, costs: [string, string, number][]): DayRecord => {
  const lines = costs.map(([categoryId, name, amount]) => ({ categoryId, name, rate: km ? amount / km : 0, amount }))
  const totalCost = lines.reduce((total, line) => total + line.amount, 0)
  return { date, km, services: [{ amount: gross }], costs: lines, gross, totalCost, commission: 0, commissionVat: 0, net: gross - totalCost }
}

const days = [
  buildDay('2026-09-30', 100000, 50, [['c1', 'Gasolina', 5000], ['c2', 'Servicio', 2000]]),
  buildDay('2026-10-01', 200000, 100, [['c1', 'Gasolina', 10000], ['c2', 'Servicio', 4000]]),
  buildDay('2026-10-02', 150000, 80, [['c1', 'Gasolina', 8000], ['c2', 'Servicio', 3000], ['c3', 'Seguro', 800]]),
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
    const buckets = aggregate(days, 'month')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-09', '2026-10'])
    const octoberBucket = buckets[1]!
    expect(octoberBucket.gross).toBe(350000)
    expect(octoberBucket.km).toBe(180)
    expect(octoberBucket.days).toBe(2)
    expect(octoberBucket.totalCost).toBe(25800)
    expect(octoberBucket.net).toBe(324200)
    expect(octoberBucket.costs.get('c1')).toEqual({ name: 'Gasolina', amount: 18000 })
    expect(octoberBucket.costs.get('c3')).toEqual({ name: 'Seguro', amount: 800 })
  })

  it('devuelve cronológico ascendente por día', () => {
    expect(aggregate(days, 'day').map(bucket => bucket.key)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('lista vacía → sin buckets', () => {
    expect(aggregate([], 'month')).toEqual([])
  })
})

describe('summarize', () => {
  it('totales, promedio diario, neto por km y mejor día', () => {
    const summary = summarize(days)
    expect(summary.gross).toBe(450000)
    expect(summary.net).toBe(450000 - 32800)
    expect(summary.days).toBe(3)
    expect(summary.avgNet).toBeCloseTo((450000 - 32800) / 3, 5)
    expect(summary.netPerKm).toBeCloseTo((450000 - 32800) / 230, 5)
    expect(summary.best?.date).toBe('2026-10-01')
  })

  it('sin datos no divide por cero', () => {
    const summary = summarize([])
    expect(summary.avgNet).toBe(0)
    expect(summary.netPerKm).toBe(0)
    expect(summary.best).toBeNull()
  })
})

describe('comisión inDrive en estadísticas', () => {
  const withCommission = { ...buildDay('2026-10-03', 10000, 10, []), commission: 950, commissionVat: 180.5, net: 8869.5 }
  it('aggregate y summarize suman comisión + IVA y usan el neto del día', () => {
    expect(aggregate([withCommission, withCommission], 'month')[0]).toMatchObject({ commission: 2261, net: 17739 })
    expect(summarize([withCommission])).toMatchObject({ commission: 1130.5, net: 8869.5 })
  })
})
