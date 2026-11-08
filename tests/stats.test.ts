import { describe, it, expect } from 'vitest'
import { aggregate, summarize, bucketKey, UNCATEGORIZED_EXPENSE } from '../app/utils/stats'
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

describe('semana ISO', () => {
  it('bucketKey agrupa lunes a domingo con clave AAAA-Www', () => {
    expect(bucketKey('2026-11-02', 'week')).toBe('2026-W45')
    expect(bucketKey('2026-11-08', 'week')).toBe('2026-W45')
    expect(bucketKey('2026-11-09', 'week')).toBe('2026-W46')
  })
  it('usa el año ISO en los bordes', () => {
    expect(bucketKey('2021-01-03', 'week')).toBe('2020-W53')
    expect(bucketKey('2024-12-30', 'week')).toBe('2025-W01')
  })
  it('aggregate agrupa por semana en orden', () => {
    const buckets = aggregate([buildDay('2026-11-09', 10, 1, []), buildDay('2026-11-08', 20, 1, []), buildDay('2026-11-02', 30, 1, [])], 'week')
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-W45', '2026-W46'])
    expect(buckets[0]!.gross).toBe(50)
  })
})

describe('ingresos por medio de pago y gastos varios', () => {
  const mixedDay = {
    ...buildDay('2026-10-05', 0, 10, []),
    services: [{ amount: 1000, bonus: 200, method: 'transfer' }, { amount: 500 }, { amount: 300, method: 'cash' }],
    gross: 2000,
    net: 2000,
  }
  const expenses = [
    { date: '2026-10-05', amount: 100, categoryId: 'comida', method: 'cash' },
    { date: '2026-10-20', amount: 50, categoryId: 'comida', method: 'transfer' },
    { date: '2026-10-21', amount: 25, method: 'cash' },
    { date: '2026-11-01', amount: 40, categoryId: 'peaje', method: 'cash' },
  ]
  const options = { defaultMethodId: 'cash' }
  it('separa ingresos por código de medio (sin medio = el medio por defecto, incluye bonus)', () => {
    const [bucket] = aggregate([mixedDay], 'month', [], options)
    expect(bucket!.incomeByMethod.get('cash')).toBe(800)
    expect(bucket!.incomeByMethod.get('transfer')).toBe(1200)
    expect(bucket).toMatchObject({ expenses: 0, netAfterExpenses: 2000 })
  })
  it('agrega gastos por categoryId y netAfterExpenses', () => {
    const buckets = aggregate([mixedDay], 'month', expenses, options)
    expect(buckets.map(bucket => bucket.key)).toEqual(['2026-10', '2026-11'])
    expect(buckets[0]!.expenses).toBe(175)
    expect(buckets[0]!.expensesByCategory.get('comida')).toBe(150)
    expect(buckets[0]!.expensesByCategory.get(UNCATEGORIZED_EXPENSE)).toBe(25)
    expect(buckets[0]!.netAfterExpenses).toBe(1825)
    expect(buckets[1]).toMatchObject({ gross: 0, expenses: 40, netAfterExpenses: -40 })
  })
  it('summarize incluye ingresos por medio y gastos', () => {
    const summary = summarize([mixedDay], expenses, options)
    expect(summary.incomeByMethod.get('cash')).toBe(800)
    expect(summary.incomeByMethod.get('transfer')).toBe(1200)
    expect(summary).toMatchObject({ expenses: 215, netAfterExpenses: 1785 })
    expect(summary.expensesByCategory.get('peaje')).toBe(40)
  })
  it('summarize sin gastos', () => {
    expect(summarize([mixedDay])).toMatchObject({ expenses: 0, netAfterExpenses: 2000 })
  })
  it('un viaje sin medio y sin medio por defecto queda en el grupo vacío', () => {
    const [bucket] = aggregate([{ ...mixedDay, services: [{ amount: 10 }] }], 'month')
    expect(bucket!.incomeByMethod.get('')).toBe(10)
  })
})
