/** Fondos por categoría de costo: lo devengado por los días vs lo transferido y gastado (puro, sin E/S). */
import type { SignedEntry } from '../services/types'
import { movementSign } from './catalogs'

export interface FundDay {
  date: string
  costs: { categoryId: string; name: string; amount: number }[]
}

export interface FundMovement {
  date: string
  categoryId: string
  /** Código de `fundMovementTypes`; su signo decide si suma o resta al fondo. */
  type: string
  amount: number
}

export interface FundRange {
  from?: string
  to?: string
}

export interface FundStatus {
  categoryId: string
  name: string
  /** Σ costos devengados por los días. */
  accrued: number
  /** Σ movimientos de tipo con signo + (envíos). */
  transferred: number
  /** Σ movimientos de tipo con signo − (gastos del fondo). */
  spent: number
  /** Total por código de tipo de movimiento. */
  byType: Map<string, number>
  /** accrued − transferred: lo que falta pasar al fondo. */
  pending: number
  /** transferred − spent: lo disponible en el fondo. */
  balance: number
}

const inRange = (date: string, range?: FundRange) => (!range?.from || date >= range.from) && (!range?.to || date <= range.to)

/**
 * Estado de cada fondo. El signo del tipo (catálogo `fundMovementTypes`) decide si el movimiento suma (enviado) o resta (gastado).
 * Regla segura: un movimiento cuyo tipo no está en el catálogo (el sync aún no lo trajo) se ignora hasta que llegue.
 */
export function fundStatus(days: FundDay[], fundMovements: FundMovement[], types: SignedEntry[], range?: FundRange): FundStatus[] {
  const byCategory = new Map<string, FundStatus>()
  const statusFor = (categoryId: string, name: string) => {
    let status = byCategory.get(categoryId)
    if (!status) {
      status = { categoryId, name, accrued: 0, transferred: 0, spent: 0, byType: new Map(), pending: 0, balance: 0 }
      byCategory.set(categoryId, status)
    } else if (status.name === status.categoryId && name !== categoryId) status.name = name
    return status
  }
  for (const day of days) {
    if (!inRange(day.date, range)) continue
    for (const cost of day.costs) statusFor(cost.categoryId, cost.name).accrued += cost.amount
  }
  for (const movement of fundMovements) {
    if (!inRange(movement.date, range)) continue
    const sign = movementSign(types, movement.type)
    if (sign === 0) continue
    const status = statusFor(movement.categoryId, movement.categoryId)
    status.byType.set(movement.type, (status.byType.get(movement.type) ?? 0) + movement.amount)
    if (sign > 0) status.transferred += movement.amount
    else status.spent += movement.amount
  }
  for (const status of byCategory.values()) {
    status.pending = status.accrued - status.transferred
    status.balance = status.transferred - status.spent
  }
  return [...byCategory.values()].sort((first, second) => first.name.localeCompare(second.name))
}
