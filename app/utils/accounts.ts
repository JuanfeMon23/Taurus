/** Saldos de las cuentas (caja, transferencias, depósito…). Lógica pura: los datos ya llegan sin registros borrados. */
import type { Account, CashDay, DatedMovement, DayRecord, MovementTypeEntry, PaymentMethod } from '../services/types'
import { cashSummary, closingBase, keptInCash } from './cash'
import { activeEntries, methodAccountId, movementSign, movementTypeRequiresDestination } from './catalogs'
import { sumCommission } from './commission'
import { tripTotal } from './trip'

/** Cuenta a la que van los cierres de caja (`toDeposit`); una regla del negocio cita su código de sistema. */
export const DEPOSIT_ACCOUNT_ID = 'deposito'

/** Saldo desde el que la cuenta de comisión (saldo inDrive) avisa que toca recargar: alcanza para pocos viajes. */
export const LOW_COMMISSION_BALANCE = 10000

/** ¿La cuenta de comisión está en negativo o baja? Las demás cuentas nunca piden recarga. */
export const needsRecharge = (account: Pick<Account, 'commissionSince'>, balance: number): boolean => !!account.commissionSince && balance <= LOW_COMMISSION_BALANCE

export interface AccountsData {
  accounts: Account[]
  paymentMethods: PaymentMethod[]
  movementTypes: MovementTypeEntry[]
  /** Todos los movimientos vivos con la cuenta ya resuelta, tenga o no caja su fecha. */
  movements: DatedMovement[]
  cashes: CashDay[]
  days: DayRecord[]
}

/**
 * Saldo de la caja física: es el del ciclo diario, sin duplicarlo. La caja más reciente abierta vale su efectivo esperado
 * (apertura + cobros en efectivo + movimientos y traslados de la cuenta caja); cerrada, lo que queda en caja tras llevar `toDeposit` al depósito.
 * Sin ninguna caja todavía, el saldo inicial de la cuenta.
 */
function cashBoxBalance(account: Account, data: AccountsData): number {
  const latest = [...data.cashes].sort((first, second) => second.date.localeCompare(first.date))[0]
  if (!latest) return account.initialBalance
  const summary = cashSummary(data.days.find(day => day.date === latest.date) ?? null, latest, data)
  return latest.closedAt ? keptInCash(closingBase(summary.expected, summary.counted), latest.toDeposit) : summary.expected
}

/**
 * Saldo de una cuenta = saldo inicial + Σ signo × monto de los movimientos que salen de ella + traslados que llegan a ella
 * + viajes (monto + bonus) cobrados con medios que llevan a ella + (depósito) Σ lo llevado al depósito en los cierres de caja
 * − (cuenta de comisión) Σ comisión + IVA de los viajes inDrive desde `commissionSince`.
 * La caja usa el ciclo diario (`cashBoxBalance`). Una cuenta desconocida vale 0.
 */
export function accountBalance(accountId: string, data: AccountsData): number {
  const account = data.accounts.find(candidate => candidate.id === accountId)
  if (!account) return 0
  if (account.isCashBox) return cashBoxBalance(account, data)
  let balance = account.initialBalance
  for (const movement of data.movements) {
    if (movement.accountId === accountId) balance += movementSign(data.movementTypes, movement.type) * movement.amount
    if (movement.toAccountId === accountId && movementTypeRequiresDestination(data.movementTypes, movement.type)) balance += movement.amount
  }
  for (const day of data.days) {
    for (const service of day.services) {
      if (methodAccountId(data.paymentMethods, service.method) === accountId) balance += tripTotal(service)
    }
  }
  if (account.commissionSince) {
    const { commission, commissionVat } = sumCommission(data.days.filter(day => day.date >= account.commissionSince!).flatMap(day => day.services.filter(service => service.isIndrive !== false)))
    balance -= commission + commissionVat
  }
  if (accountId === DEPOSIT_ACCOUNT_ID) balance += data.cashes.reduce((total, cash) => total + (cash.toDeposit ?? 0), 0)
  return balance
}

/** Cuentas activas en orden de presentación, cada una con su saldo. */
export const accountBalances = (data: AccountsData): { account: Account; balance: number }[] =>
  activeEntries(data.accounts).map(account => ({ account, balance: accountBalance(account.id, data) }))

/** Efecto de un movimiento sobre una cuenta: +1 si le entra (destino de un traslado o tipo que suma), −1 si le sale, 0 si no la toca. */
export function movementDirection(movement: { type: string; accountId?: string; toAccountId?: string }, accountId: string, movementTypes: MovementTypeEntry[]): 1 | -1 | 0 {
  if (movement.toAccountId === accountId && movementTypeRequiresDestination(movementTypes, movement.type)) return 1
  return movement.accountId === accountId ? movementSign(movementTypes, movement.type) : 0
}
