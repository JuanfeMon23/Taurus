import type { CashDay, DayRecord, DepositMovement } from '../services/types'
import { tripTotal } from './trip'

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

const sumMovements = (cash: CashDay | null, type: CashDay['movements'][number]['type']) =>
  (cash?.movements ?? []).filter(movement => movement.type === type).reduce((total, movement) => total + movement.amount, 0)

/** Efectivo esperado en caja: apertura + cobros en efectivo + aportes − gastos − retiros. */
export function cashSummary(day: DayRecord | null, cash: CashDay | null): CashSummary {
  const services = day?.services ?? []
  const cashIncome = services.filter(service => (service.method ?? 'cash') === 'cash').reduce((total, service) => total + tripTotal(service), 0)
  const transferIncome = services.filter(service => service.method === 'transfer').reduce((total, service) => total + tripTotal(service), 0)
  const opening = cash?.opening ?? 0
  const expenses = sumMovements(cash, 'expense')
  const withdrawals = sumMovements(cash, 'withdrawal')
  const deposits = sumMovements(cash, 'deposit')
  const expected = cash ? opening + cashIncome - expenses - withdrawals + deposits : 0
  const counted = cash?.closedAt ? cash.counted : undefined
  return {
    opening, cashIncome, transferIncome, expenses, withdrawals, deposits, expected,
    counted,
    difference: counted !== undefined ? counted - expected : undefined,
  }
}

/** Base del cierre: lo contado, o el efectivo esperado si no hay conteo. */
export const closingBase = (expected: number, counted?: number) => counted ?? expected

/** Lo que queda en caja tras llevar `toDeposit` al depósito. */
export const keptInCash = (base: number, toDeposit?: number) => base - (toDeposit ?? 0)

/** Mensaje en español si el cierre no es válido; null si lo es. */
export function validateClosing(input: { expected: number; counted?: number | null; toDeposit?: number | null }): string | null {
  const counted = input.counted ?? undefined
  const toDeposit = input.toDeposit ?? undefined
  if ((counted ?? 0) < 0 || (toDeposit ?? 0) < 0) return 'Los montos no pueden ser negativos.'
  if (toDeposit !== undefined && toDeposit > closingBase(input.expected, counted)) {
    return counted !== undefined
      ? 'Lo que va al depósito no puede superar lo contado.'
      : 'Lo que va al depósito no puede superar el efectivo esperado.'
  }
  return null
}

/** Saldo del depósito = Σ lo depositado en las cajas − Σ salidas del depósito. */
export const depositBalance = (cashes: CashDay[], outflows: DepositMovement[]) =>
  cashes.reduce((total, cash) => total + (cash.toDeposit ?? 0), 0) - outflows.reduce((total, outflow) => total + outflow.amount, 0)

/** Apertura sugerida: lo que quedó en caja en el cierre más reciente anterior a `date`. */
export function suggestedOpening(cashes: CashDay[], days: DayRecord[], date: string): number | undefined {
  const previousCash = cashes.filter(cash => cash.closedAt && cash.date < date).sort((first, second) => second.date.localeCompare(first.date))[0]
  if (!previousCash) return undefined
  const previousSummary = cashSummary(days.find(day => day.date === previousCash.date) ?? null, previousCash)
  return keptInCash(closingBase(previousSummary.expected, previousSummary.counted), previousCash.toDeposit)
}
