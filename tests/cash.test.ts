import { describe, it, expect } from 'vitest'
import { cashSummary } from '../app/utils/cash'
import type { CashDay, DayRecord } from '../app/services/types'

const day = (services: DayRecord['services']): DayRecord => ({
  date: '2026-10-15', km: 80, services, costs: [], gross: 0, totalCost: 0, net: 0,
})
const cash = (over: Partial<CashDay> = {}): CashDay => ({
  date: '2026-10-15', opening: 50000, openedAt: '2026-10-15T07:00:00', movements: [], ...over,
})

describe('cashSummary', () => {
  it('esperado = apertura + efectivo cobrado - gastos - retiros', () => {
    const r = cashSummary(
      day([{ amount: 40000 }, { amount: 30000, method: 'cash' }, { amount: 20000, method: 'transfer' }]),
      cash({ movements: [
        { id: 'm1', type: 'expense', amount: 8000, note: 'gasolina' },
        { id: 'm2', type: 'withdrawal', amount: 20000 },
        { id: 'm3', type: 'deposit', amount: 5000 },
      ] }),
    )
    expect(r.cashIncome).toBe(70000)
    expect(r.transferIncome).toBe(20000)
    expect(r.expenses).toBe(8000)
    expect(r.withdrawals).toBe(20000)
    expect(r.deposits).toBe(5000)
    expect(r.expected).toBe(50000 + 70000 - 8000 - 20000 + 5000)
  })

  it('un servicio sin método cuenta como efectivo', () => {
    expect(cashSummary(day([{ amount: 1000 }]), cash({ opening: 0 })).cashIncome).toBe(1000)
  })

  it('el bonus en efectivo suma al efectivo esperado', () => {
    const r = cashSummary(day([{ amount: 10000, bonus: 2000, method: 'cash' }]), cash({ opening: 0 }))
    expect(r.cashIncome).toBe(12000)
    expect(r.transferIncome).toBe(0)
    expect(r.expected).toBe(12000)
  })

  it('el bonus en transferencia suma a transferencias y no al efectivo', () => {
    const r = cashSummary(day([{ amount: 10000, bonus: 3000, method: 'transfer' }]), cash({ opening: 0 }))
    expect(r.transferIncome).toBe(13000)
    expect(r.cashIncome).toBe(0)
    expect(r.expected).toBe(0)
  })

  it('un servicio sin bonus se calcula igual que antes', () => {
    const r = cashSummary(day([{ amount: 10000, bonus: 0 }, { amount: 5000, bonus: null, method: 'transfer' }]), cash({ opening: 0 }))
    expect(r.cashIncome).toBe(10000)
    expect(r.transferIncome).toBe(5000)
  })

  it('sin caja abierta todo es cero', () => {
    const r = cashSummary(null, null)
    expect(r.expected).toBe(0)
    expect(r.difference).toBeUndefined()
  })

  it('al cerrar calcula la diferencia contra lo contado', () => {
    const r = cashSummary(day([{ amount: 10000 }]), cash({ closedAt: '2026-10-15T20:00:00', counted: 58000 }))
    expect(r.expected).toBe(60000)
    expect(r.difference).toBe(-2000)
  })
})
