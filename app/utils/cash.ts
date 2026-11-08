import type { CashDay, DayRecord, DepositMovement, MovementTypeEntry, PaymentMethod } from '../services/types'
import { defaultMethodId, methodAffectsCash, movementSign } from './catalogs'
import { tripTotal } from './trip'

/** Catálogos que necesita el cálculo de caja. */
export interface CashCatalogs {
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
  /** Movimientos que suman / restan al efectivo (solo los de medios que afectan la caja). */
  inflows: number
  outflows: number
  /** Total por código de tipo de movimiento (solo medios que afectan la caja). */
  totalsByType: Map<string, number>
  expected: number
  counted?: number
  /** contado − esperado; solo existe si la caja se cerró con conteo. */
  difference?: number
}

/**
 * Efectivo esperado = apertura + ingresos en medios que afectan la caja + Σ movimientos × signo del tipo (solo medios que afectan la caja).
 * Reglas seguras: tipo fuera del catálogo = no mueve el efectivo; medio fuera del catálogo = afecta la caja; sin medio = medio por defecto.
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
  for (const movement of cash?.movements ?? []) {
    if (!methodAffectsCash(catalogs.paymentMethods, movement.method)) continue
    totalsByType.set(movement.type, (totalsByType.get(movement.type) ?? 0) + movement.amount)
    const sign = movementSign(catalogs.movementTypes, movement.type)
    if (sign > 0) inflows += movement.amount
    else if (sign < 0) outflows += movement.amount
  }
  const opening = cash?.opening ?? 0
  const expected = cash ? opening + cashIncome + inflows - outflows : 0
  const counted = cash?.closedAt ? cash.counted : undefined
  return {
    opening, cashIncome, nonCashIncome, incomeByMethod, inflows, outflows, totalsByType, expected,
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
export function suggestedOpening(cashes: CashDay[], days: DayRecord[], date: string, catalogs: CashCatalogs): number | undefined {
  const previousCash = cashes.filter(cash => cash.closedAt && cash.date < date).sort((first, second) => second.date.localeCompare(first.date))[0]
  if (!previousCash) return undefined
  const previousSummary = cashSummary(days.find(day => day.date === previousCash.date) ?? null, previousCash, catalogs)
  return keptInCash(closingBase(previousSummary.expected, previousSummary.counted), previousCash.toDeposit)
}
