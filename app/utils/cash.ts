import type { CashDay, DayRecord } from '../services/types'

export interface CashSummary {
  opening: number
  cashIncome: number
  transferIncome: number
  expenses: number
  withdrawals: number
  deposits: number
  expected: number
  counted?: number
  /** contado − esperado; solo existe si la caja se cerró con conteo. */
  difference?: number
}

const sum = (cash: CashDay | null, type: CashDay['movements'][number]['type']) =>
  (cash?.movements ?? []).filter(m => m.type === type).reduce((s, m) => s + m.amount, 0)

/** Efectivo esperado en caja: apertura + cobros en efectivo + aportes − gastos − retiros. */
export function cashSummary(day: DayRecord | null, cash: CashDay | null): CashSummary {
  const services = day?.services ?? []
  const cashIncome = services.filter(s => (s.method ?? 'cash') === 'cash').reduce((t, s) => t + s.amount, 0)
  const transferIncome = services.filter(s => s.method === 'transfer').reduce((t, s) => t + s.amount, 0)
  const opening = cash?.opening ?? 0
  const expenses = sum(cash, 'expense')
  const withdrawals = sum(cash, 'withdrawal')
  const deposits = sum(cash, 'deposit')
  const expected = cash ? opening + cashIncome - expenses - withdrawals + deposits : 0
  const counted = cash?.closedAt ? cash.counted : undefined
  return {
    opening, cashIncome, transferIncome, expenses, withdrawals, deposits, expected,
    counted,
    difference: counted !== undefined ? counted - expected : undefined,
  }
}
