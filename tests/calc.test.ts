import { describe, it, expect } from 'vitest'
import { categoryRate, computeDay, type Category } from '../app/utils/calc'

const gasolina: Category = { id: 'c1', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }
const servicio: Category = { id: 'c2', name: 'Servicio', rateMode: 'derived', totalCost: 160000, intervalKm: 3500, active: true }

describe('categoryRate', () => {
  it('usa el valor directo por km', () => {
    expect(categoryRate(gasolina)).toBe(100)
  })
  it('deriva costo_total / intervalo_km', () => {
    expect(categoryRate(servicio)).toBeCloseTo(45.714, 3)
  })
  it('devuelve 0 si el intervalo es 0 o inválido', () => {
    expect(categoryRate({ ...servicio, intervalKm: 0 })).toBe(0)
  })
})

describe('computeDay', () => {
  it('calcula bruto, costos por categoría y neto', () => {
    const r = computeDay({ services: [120000, 80000], km: 100, categories: [gasolina, servicio] })
    expect(r.gross).toBe(200000)
    expect(r.costs.map(c => c.amount)).toEqual([10000, expect.closeTo(4571.43, 1)])
    expect(r.totalCost).toBeCloseTo(14571.43, 1)
    expect(r.net).toBeCloseTo(185428.57, 1)
  })
  it('ignora categorías inactivas', () => {
    const r = computeDay({ services: [50000], km: 10, categories: [gasolina, { ...servicio, active: false }] })
    expect(r.costs).toHaveLength(1)
    expect(r.net).toBe(49000)
  })
  it('sin servicios ni km da cero', () => {
    const r = computeDay({ services: [], km: 0, categories: [gasolina] })
    expect(r.gross).toBe(0)
    expect(r.net).toBe(0)
  })
})
