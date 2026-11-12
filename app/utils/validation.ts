import type { Account } from '../services/types'
import { slugifyCode } from './catalogs'

const isPositiveAmount = (amount: number | null | undefined): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount > 0

/** Mensaje en español si el movimiento de caja no es válido; null si lo es. */
export function validateMovementInput(input: { type: string; amount: number | null | undefined; accountId: string; toAccountId?: string; requiresDestination?: boolean }): string | null {
  if (!input.type) return 'Elige el tipo de movimiento.'
  if (!isPositiveAmount(input.amount)) return 'Escribe un monto mayor que cero.'
  if (!input.accountId) return 'Elige la cuenta.'
  if (input.requiresDestination) {
    if (!input.toAccountId) return 'Elige la cuenta de destino.'
    if (input.toAccountId === input.accountId) return 'El destino debe ser distinto de la cuenta de origen.'
  }
  return null
}

/** Mensaje en español si el envío/gasto de un fondo no es válido; null si lo es. */
export function validateFundMovementInput(input: { amount: number | null | undefined; date: string; categoryId: string }): string | null {
  if (!input.categoryId) return 'Elige el fondo.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Elige una fecha válida.'
  if (!isPositiveAmount(input.amount)) return 'Escribe un monto mayor que cero.'
  return null
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Mensaje en español si el turno no es válido; null si lo es. El fin vacío es un turno en curso; fin < inicio cruza la medianoche. */
export function validateShiftInput(input: { startTime: string | null | undefined; endTime?: string | null }): string | null {
  const start = (input.startTime ?? '').trim()
  const end = (input.endTime ?? '').trim()
  if (!start) return 'Escribe la hora de inicio del turno.'
  if (!CLOCK_TIME.test(start)) return 'La hora de inicio no es válida.'
  if (end && !CLOCK_TIME.test(end)) return 'La hora de fin no es válida.'
  if (end && end === start) return 'El inicio y el fin del turno no pueden ser iguales.'
  return null
}

const MAX_TEMPLATE_NAME = 40
const MAX_CATALOG_NAME = 60

/** Mensaje en español si la plantilla de turno no es válida; null si lo es. A diferencia del turno del día, el fin es obligatorio. */
export function validateShiftTemplateInput(input: { name: string; startTime: string | null | undefined; endTime: string | null | undefined }): string | null {
  const name = input.name.trim()
  if (!name) return 'Escribe el nombre de la plantilla.'
  if (name.length > MAX_TEMPLATE_NAME) return `El nombre no puede superar ${MAX_TEMPLATE_NAME} caracteres.`
  if (!(input.endTime ?? '').trim() && (input.startTime ?? '').trim()) return 'Escribe la hora de fin del turno.'
  return validateShiftInput(input)
}

/** Mensaje en español si el nombre de una entrada de catálogo no es válido; `otherNames` = nombres de las demás entradas. */
export function validateCatalogEntryInput(name: string, otherNames: string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Escribe un nombre.'
  if (trimmed.length > MAX_CATALOG_NAME) return `El nombre no puede superar ${MAX_CATALOG_NAME} caracteres.`
  if (!slugifyCode(trimmed)) return 'El nombre debe tener letras o números.'
  if (otherNames.some(other => slugifyCode(other) === slugifyCode(trimmed))) return 'Ya existe una opción con ese nombre.'
  return null
}

/* Reglas de las cuentas: mismos mensajes que el 422 `account_rule_violation` del backend. */
export const ACCOUNT_RULE_MESSAGES = {
  singleCommission: 'Solo una cuenta puede ser la de comisión',
  cashBoxCommission: 'La caja no puede ser la cuenta de comisión',
  methodOnCommission: 'Un medio de pago no puede apuntar a la cuenta de comisión',
  hasMovements: 'Una cuenta con movimientos no se puede desactivar ni borrar',
} as const

/** Mensaje si la cuenta incumple una regla (una sola de comisión, nunca la caja, no desactivar con movimientos); `otherAccounts` = las demás. */
export function validateAccountRules(account: Pick<Account, 'isCashBox' | 'active' | 'commissionSince'>, otherAccounts: Pick<Account, 'commissionSince'>[], hasMovements: boolean): string | null {
  if (account.commissionSince) {
    if (account.isCashBox) return ACCOUNT_RULE_MESSAGES.cashBoxCommission
    if (otherAccounts.some(other => other.commissionSince)) return ACCOUNT_RULE_MESSAGES.singleCommission
  }
  if (!account.active && hasMovements) return ACCOUNT_RULE_MESSAGES.hasMovements
  return null
}

/** Mensaje si la cuenta elegida para un medio de pago es la de comisión (la recarga es un traslado, no un cobro). */
export const validateMethodAccount = (accountId: string, accounts: Pick<Account, 'id' | 'commissionSince'>[]): string | null =>
  accounts.find(account => account.id === accountId)?.commissionSince ? ACCOUNT_RULE_MESSAGES.methodOnCommission : null
