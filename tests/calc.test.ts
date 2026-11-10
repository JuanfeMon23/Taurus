import { describe, it, expect } from 'vitest'
import { categoryRate, computeDay, type Category } from '../app/utils/calc'
import type { RateMode } from '../app/services/types'

const rateModes: RateMode[] = [
  { id: 'direct', name: 'Valor por km', usesRatePerKm: true, usesCostInterval: false, sortOrder: 0, active: true },
  { id: 'derived', name: 'Costo cada X km', usesRatePerKm: false, usesCostInterval: true, sortOrder: 1, active: true },
]

const gasolina: Category = { id: 'c1', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }
const servicio: Category = { id: 'c2', name: 'Servicio', rateMode: 'derived', totalCost: 160000, intervalKm: 3500, active: true }

describe('categoryRate', () => {
  it('usa el valor directo por km', () => {
    expect(categoryRate(gasolina, rateModes)).toBe(100)
  })
  it('deriva costo_total / intervalo_km', () => {
    expect(categoryRate(servicio, rateModes)).toBeCloseTo(45.714, 3)
  })
  it('devuelve 0 si el intervalo es 0 o inválido', () => {
    expect(categoryRate({ ...servicio, intervalKm: 0 }, rateModes)).toBe(0)
  })
})

describe('categoryRate con modos del catálogo', () => {
  it('un modo nuevo con valor por km calcula como el directo (seguro de moto 18 $/km)', () => {
    const seguroMode: RateMode = { id: 'per-km-flat', name: 'Fijo por km', usesRatePerKm: true, usesCostInterval: false, sortOrder: 2, active: true }
    const seguro: Category = { id: 'c3', name: 'Seguro', rateMode: 'per-km-flat', ratePerKm: 18, active: true }
    expect(categoryRate(seguro, [...rateModes, seguroMode])).toBe(18)
  })
  it('un modo con las dos marcas suma valor por km y costo / intervalo', () => {
    const both: RateMode = { id: 'both', name: 'Ambos', usesRatePerKm: true, usesCostInterval: true, sortOrder: 2, active: true }
    expect(categoryRate({ ...servicio, rateMode: 'both', ratePerKm: 10, totalCost: 100, intervalKm: 10 }, [both])).toBe(20)
  })
  it('un modo ausente del catálogo o sin marcas vale 0', () => {
    expect(categoryRate(gasolina, [])).toBe(0)
    expect(categoryRate(gasolina, [{ ...rateModes[0]!, usesRatePerKm: false }])).toBe(0)
  })
  it('ignora los campos de otro modo', () => {
    expect(categoryRate({ ...gasolina, totalCost: 999, intervalKm: 1 }, rateModes)).toBe(100)
  })
})

describe('computeDay', () => {
  it('calcula bruto, costos por categoría y neto', () => {
    const dayResult = computeDay({ services: [120000, 80000], km: 100, rateModes, categories: [gasolina, servicio] })
    expect(dayResult.gross).toBe(200000)
    expect(dayResult.costs.map(costLine => costLine.amount)).toEqual([10000, expect.closeTo(4571.43, 1)])
    expect(dayResult.totalCost).toBeCloseTo(14571.43, 1)
    expect(dayResult.net).toBeCloseTo(185428.57, 1)
  })
  it('ignora categorías inactivas', () => {
    const dayResult = computeDay({ services: [50000], km: 10, rateModes, categories: [gasolina, { ...servicio, active: false }] })
    expect(dayResult.costs).toHaveLength(1)
    expect(dayResult.net).toBe(49000)
  })
  it('sin servicios ni km da cero', () => {
    const dayResult = computeDay({ services: [], km: 0, rateModes, categories: [gasolina] })
    expect(dayResult.gross).toBe(0)
    expect(dayResult.net).toBe(0)
  })
})
