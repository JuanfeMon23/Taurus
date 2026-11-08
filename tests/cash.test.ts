import { describe, it, expect } from 'vitest'
import { cashSummary } from '../app/utils/cash'
import type { CashDay, DayRecord } from '../app/services/types'
import { testCatalogs } from './fixtures/catalogs'

const catalogs = testCatalogs()
const day = (services: DayRecord['services']): DayRecord => ({
  date: '2026-10-15', km: 80, services, costs: [], gross: 0, totalCost: 0, net: 0,
})
const cash = (overrides: Partial<CashDay> = {}): CashDay => ({
  date: '2026-10-15', opening: 50000, openedAt: '2026-10-15T07:00:00', movements: [], ...overrides,
})

describe('cashSummary', () => {
  it('esperado = apertura + efectivo cobrado + movimientos según su signo', () => {
    const summary = cashSummary(
      day([{ amount: 40000 }, { amount: 30000, method: 'cash' }, { amount: 20000, method: 'transfer' }]),
      cash({ movements: [
        { id: 'm1', type: 'expense', amount: 8000, note: 'gasolina' },
        { id: 'm2', type: 'withdrawal', amount: 20000 },
        { id: 'm3', type: 'deposit', amount: 5000 },
      ] }),
      catalogs,
    )
    expect(summary.cashIncome).toBe(70000)
    expect(summary.nonCashIncome).toBe(20000)
    expect(summary.totalsByType.get('expense')).toBe(8000)
    expect(summary.totalsByType.get('withdrawal')).toBe(20000)
    expect(summary.totalsByType.get('deposit')).toBe(5000)
    expect(summary.inflows).toBe(5000)
    expect(summary.outflows).toBe(28000)
    expect(summary.expected).toBe(50000 + 70000 - 8000 - 20000 + 5000)
  })

  it('movimientos con un medio que no afecta la caja no la tocan; sin medio usan el medio por defecto', () => {
    const summary = cashSummary(day([{ amount: 10000 }]), cash({ movements: [
      { id: 'm1', type: 'expense', amount: 8000 },
      { id: 'm2', type: 'expense', amount: 5000, method: 'transfer', categoryId: 'parqueadero' },
      { id: 'm3', type: 'withdrawal', amount: 3000, method: 'transfer' },
      { id: 'm4', type: 'withdrawal', amount: 2000, method: 'cash' },
    ] }), catalogs)
    expect(summary.totalsByType.get('expense')).toBe(8000)
    expect(summary.totalsByType.get('withdrawal')).toBe(2000)
    expect(summary.expected).toBe(50000 + 10000 - 8000 - 2000)
  })

  it('el signo y el efecto en caja salen del catálogo, no del código', () => {
    const custom = {
      paymentMethods: [{ id: 'wallet', name: 'Billetera', affectsCash: false, sortOrder: 0, active: true }, { id: 'coins', name: 'Monedas', affectsCash: true, sortOrder: 1, active: true }],
      movementTypes: [{ id: 'tip-out', name: 'Propina entregada', sign: -1 as const, sortOrder: 0, active: true }, { id: 'refund', name: 'Reembolso', sign: 1 as const, sortOrder: 1, active: true }],
    }
    const summary = cashSummary(
      day([{ amount: 1000, method: 'wallet' }, { amount: 2000, method: 'coins' }]),
      cash({ opening: 0, movements: [
        { id: 'a', type: 'tip-out', amount: 300, method: 'coins' },
        { id: 'b', type: 'refund', amount: 500, method: 'coins' },
        { id: 'c', type: 'refund', amount: 900, method: 'wallet' },
      ] }),
      custom,
    )
    expect(summary.cashIncome).toBe(2000)
    expect(summary.nonCashIncome).toBe(1000)
    expect(summary.expected).toBe(2000 - 300 + 500)
  })

  it('regla segura: un tipo desconocido no mueve la caja y un medio desconocido cuenta como efectivo', () => {
    const summary = cashSummary(day([{ amount: 1000, method: 'nequi' }]), cash({ opening: 0, movements: [
      { id: 'a', type: 'misterio', amount: 700 },
      { id: 'b', type: 'expense', amount: 100, method: 'nequi' },
    ] }), catalogs)
    expect(summary.cashIncome).toBe(1000)
    expect(summary.expected).toBe(1000 - 100)
  })

  it('un servicio sin método cuenta como efectivo (medio por defecto)', () => {
    expect(cashSummary(day([{ amount: 1000 }]), cash({ opening: 0 }), catalogs).cashIncome).toBe(1000)
  })

  it('el bonus en efectivo suma al efectivo esperado', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 2000, method: 'cash' }]), cash({ opening: 0 }), catalogs)
    expect(summary.cashIncome).toBe(12000)
    expect(summary.nonCashIncome).toBe(0)
    expect(summary.expected).toBe(12000)
  })

  it('el bonus en un medio fuera de caja suma a ese medio y no al efectivo', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 3000, method: 'transfer' }]), cash({ opening: 0 }), catalogs)
    expect(summary.nonCashIncome).toBe(13000)
    expect(summary.incomeByMethod.get('transfer')).toBe(13000)
    expect(summary.cashIncome).toBe(0)
    expect(summary.expected).toBe(0)
  })

  it('un servicio sin bonus se calcula igual que antes', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 0 }, { amount: 5000, bonus: null, method: 'transfer' }]), cash({ opening: 0 }), catalogs)
    expect(summary.cashIncome).toBe(10000)
    expect(summary.nonCashIncome).toBe(5000)
  })

  it('sin caja abierta todo es cero', () => {
    const summary = cashSummary(null, null, catalogs)
    expect(summary.expected).toBe(0)
    expect(summary.difference).toBeUndefined()
  })

  it('al cerrar calcula la diferencia contra lo contado', () => {
    const summary = cashSummary(day([{ amount: 10000 }]), cash({ closedAt: '2026-10-15T20:00:00', counted: 58000 }), catalogs)
    expect(summary.expected).toBe(60000)
    expect(summary.difference).toBe(-2000)
  })
})
