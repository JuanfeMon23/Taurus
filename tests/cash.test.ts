import { describe, it, expect } from 'vitest'
import { cashSummary } from '../app/utils/cash'
import type { CashDay, DayRecord } from '../app/services/types'

const day = (services: DayRecord['services']): DayRecord => ({
  date: '2026-10-15', km: 80, services, costs: [], gross: 0, totalCost: 0, net: 0,
})
const cash = (overrides: Partial<CashDay> = {}): CashDay => ({
  date: '2026-10-15', opening: 50000, openedAt: '2026-10-15T07:00:00', movements: [], ...overrides,
})

describe('cashSummary', () => {
  it('esperado = apertura + efectivo cobrado - gastos - retiros', () => {
    const summary = cashSummary(
      day([{ amount: 40000 }, { amount: 30000, method: 'cash' }, { amount: 20000, method: 'transfer' }]),
      cash({ movements: [
        { id: 'm1', type: 'expense', amount: 8000, note: 'gasolina' },
        { id: 'm2', type: 'withdrawal', amount: 20000 },
        { id: 'm3', type: 'deposit', amount: 5000 },
      ] }),
    )
    expect(summary.cashIncome).toBe(70000)
    expect(summary.transferIncome).toBe(20000)
    expect(summary.expenses).toBe(8000)
    expect(summary.withdrawals).toBe(20000)
    expect(summary.deposits).toBe(5000)
    expect(summary.expected).toBe(50000 + 70000 - 8000 - 20000 + 5000)
  })

  it('un servicio sin método cuenta como efectivo', () => {
    expect(cashSummary(day([{ amount: 1000 }]), cash({ opening: 0 })).cashIncome).toBe(1000)
  })

  it('el bonus en efectivo suma al efectivo esperado', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 2000, method: 'cash' }]), cash({ opening: 0 }))
    expect(summary.cashIncome).toBe(12000)
    expect(summary.transferIncome).toBe(0)
    expect(summary.expected).toBe(12000)
  })

  it('el bonus en transferencia suma a transferencias y no al efectivo', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 3000, method: 'transfer' }]), cash({ opening: 0 }))
    expect(summary.transferIncome).toBe(13000)
    expect(summary.cashIncome).toBe(0)
    expect(summary.expected).toBe(0)
  })

  it('un servicio sin bonus se calcula igual que antes', () => {
    const summary = cashSummary(day([{ amount: 10000, bonus: 0 }, { amount: 5000, bonus: null, method: 'transfer' }]), cash({ opening: 0 }))
    expect(summary.cashIncome).toBe(10000)
    expect(summary.transferIncome).toBe(5000)
  })

  it('sin caja abierta todo es cero', () => {
    const summary = cashSummary(null, null)
    expect(summary.expected).toBe(0)
    expect(summary.difference).toBeUndefined()
  })

  it('al cerrar calcula la diferencia contra lo contado', () => {
    const summary = cashSummary(day([{ amount: 10000 }]), cash({ closedAt: '2026-10-15T20:00:00', counted: 58000 }))
    expect(summary.expected).toBe(60000)
    expect(summary.difference).toBe(-2000)
  })
})
