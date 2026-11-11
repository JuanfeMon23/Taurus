import type { Account, CashDay, DayRecord, MovementTypeEntry, PaymentMethod } from '../services/types'
import { accountIsCashBox, defaultMethodId, methodAffectsCash, movementAccountId, movementSign, movementTypeRequiresDestination } from './catalogs'
import { tripTotal } from './trip'

/** Catálogos que necesita el cálculo de caja. */
export interface CashCatalogs {
  accounts: Account[]
  paymentMethods: PaymentMethod[]
  movementTypes: MovementTypeEntry[]
}

export interface CashSummary {
  opening: number
  /** Ingresos de viajes (viaje + bonus) en medios que afectan la caja. */
  cashIncome: number
  /** Ingresos de viajes en medios que no afectan la caja (p. ej. transferencias). */
  nonCashIncome: number
  /** Ingresos de viajes por código de medio de pago. */
  incomeByMethod: Map<string, number>
  /** Movimientos que suman / restan al efectivo (solo los de la cuenta caja). */
  inflows: number
  outflows: number
  /** Traslados desde otras cuentas que llegan a la caja. */
  transfersIn: number
  /** Total por código de tipo de movimiento (solo los de la cuenta caja). */
  totalsByType: Map<string, number>
  expected: number
  counted?: number
  /** contado − esperado; solo existe si la caja se cerró con conteo. */
  difference?: number
}

/**
 * Efectivo esperado = apertura + ingresos en medios que afectan la caja + Σ movimientos de la cuenta caja × signo del tipo + traslados que llegan a la caja.
 * Reglas seguras: tipo fuera del catálogo = no mueve el efectivo; medio o cuenta fuera del catálogo = caja; movimiento viejo sin cuenta = la de su medio.
 */
export function cashSummary(day: DayRecord | null, cash: CashDay | null, catalogs: CashCatalogs): CashSummary {
  const incomeByMethod = new Map<string, number>()
  let cashIncome = 0
  let nonCashIncome = 0
  for (const service of day?.services ?? []) {
    const methodId = service.method ?? defaultMethodId(catalogs.paymentMethods) ?? ''
    const total = tripTotal(service)
    incomeByMethod.set(methodId, (incomeByMethod.get(methodId) ?? 0) + total)
    if (methodAffectsCash(catalogs.paymentMethods, service.method)) cashIncome += total
    else nonCashIncome += total
  }
  const totalsByType = new Map<string, number>()
  let inflows = 0
  let outflows = 0
  let transfersIn = 0
  for (const movement of cash?.movements ?? []) {
    const arrivesInCashBox = movementTypeRequiresDestination(catalogs.movementTypes, movement.type)
      && catalogs.accounts.find(account => account.id === movement.toAccountId)?.isCashBox === true
    if (!accountIsCashBox(catalogs.accounts, movementAccountId(movement, catalogs))) {
      if (arrivesInCashBox) transfersIn += movement.amount
      continue
    }
    totalsByType.set(movement.type, (totalsByType.get(movement.type) ?? 0) + movement.amount)
    const sign = movementSign(catalogs.movementTypes, movement.type)
    if (sign > 0) inflows += movement.amount
    else if (sign < 0) outflows += movement.amount
  }
  const opening = cash?.opening ?? 0
  const expected = cash ? opening + cashIncome + inflows + transfersIn - outflows : 0
  const counted = cash?.closedAt ? cash.counted : undefined
  return {
    opening, cashIncome, nonCashIncome, incomeByMethod, inflows, outflows, transfersIn, totalsByType, expected,
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

/** Apertura sugerida: lo que quedó en caja en el cierre más reciente anterior a `date`. */
export function suggestedOpening(cashes: CashDay[], days: DayRecord[], date: string, catalogs: CashCatalogs): number | undefined {
  const previousCash = cashes.filter(cash => cash.closedAt && cash.date < date).sort((first, second) => second.date.localeCompare(first.date))[0]
  if (!previousCash) return undefined
  const previousSummary = cashSummary(days.find(day => day.date === previousCash.date) ?? null, previousCash, catalogs)
  return keptInCash(closingBase(previousSummary.expected, previousSummary.counted), previousCash.toDeposit)
}
