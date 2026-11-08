import { describe, it, expect } from 'vitest'
import { fundStatus } from '../app/utils/funds'
import { testCatalogs } from './fixtures/catalogs'

const { fundMovementTypes } = testCatalogs()

const days = [
  { date: '2026-10-01', costs: [{ categoryId: 'fuel', name: 'Gasolina', amount: 100 }, { categoryId: 'tires', name: 'Llantas', amount: 20 }] },
  { date: '2026-10-02', costs: [{ categoryId: 'fuel', name: 'Gasolina', amount: 50 }] },
  { date: '2026-11-01', costs: [{ categoryId: 'fuel', name: 'Gasolina', amount: 10 }] },
]
const movements = [
  { date: '2026-10-02', categoryId: 'fuel', type: 'transfer', amount: 120 },
  { date: '2026-10-03', categoryId: 'fuel', type: 'spend', amount: 70 },
  { date: '2026-10-03', categoryId: 'brakes', type: 'transfer', amount: 30 },
]

describe('fundStatus', () => {
  it('calcula accrued, transferred, spent, pending y balance por categoría', () => {
    const status = fundStatus(days, movements, fundMovementTypes)
    expect(status.find(item => item.categoryId === 'fuel')).toEqual({
      categoryId: 'fuel', name: 'Gasolina', accrued: 160, transferred: 120, spent: 70, pending: 40, balance: 50,
      byType: new Map([['transfer', 120], ['spend', 70]]),
    })
    expect(status.find(item => item.categoryId === 'tires')).toMatchObject({ accrued: 20, transferred: 0, pending: 20, balance: 0 })
  })
  it('categoría solo con movimientos aparece (sin nombre → id)', () => {
    expect(fundStatus(days, movements, fundMovementTypes).find(item => item.categoryId === 'brakes')).toMatchObject({ name: 'brakes', accrued: 0, transferred: 30, pending: -30, balance: 30 })
  })
  it('un movimiento previo al día no deja el id como nombre', () => {
    const status = fundStatus([{ date: '2026-10-05', costs: [{ categoryId: 'fuel', name: 'Gasolina', amount: 5 }] }], movements, fundMovementTypes)
    expect(status.find(item => item.categoryId === 'fuel')?.name).toBe('Gasolina')
  })
  it('filtra por rango inclusivo', () => {
    const status = fundStatus(days, movements, fundMovementTypes, { from: '2026-10-01', to: '2026-10-31' })
    expect(status.find(item => item.categoryId === 'fuel')).toMatchObject({ accrued: 150 })
  })
  it('rango parcial (solo from) y sin datos', () => {
    expect(fundStatus(days, movements, fundMovementTypes, { from: '2026-11-01' }).find(item => item.categoryId === 'fuel')).toMatchObject({ accrued: 10, transferred: 0 })
    expect(fundStatus([], [], fundMovementTypes)).toEqual([])
  })
  it('orden estable por nombre', () => {
    expect(fundStatus(days, movements, fundMovementTypes).map(item => item.name)).toEqual(['brakes', 'Gasolina', 'Llantas'])
  })
  it('el signo del tipo decide si suma o resta, no su código', () => {
    const custom = [{ id: 'topup', name: 'Recarga', sign: 1 as const, sortOrder: 0, active: true }, { id: 'purchase', name: 'Compra', sign: -1 as const, sortOrder: 1, active: true }]
    const status = fundStatus([], [
      { date: '2026-10-01', categoryId: 'fuel', type: 'topup', amount: 100 },
      { date: '2026-10-02', categoryId: 'fuel', type: 'purchase', amount: 30 },
    ], custom)
    expect(status[0]).toMatchObject({ transferred: 100, spent: 30, balance: 70 })
  })
  it('regla segura: un tipo que no está en el catálogo no afecta saldos', () => {
    const status = fundStatus(days, [{ date: '2026-10-02', categoryId: 'fuel', type: 'misterio', amount: 999 }], fundMovementTypes)
    expect(status.find(item => item.categoryId === 'fuel')).toMatchObject({ transferred: 0, spent: 0, balance: 0 })
  })
})
