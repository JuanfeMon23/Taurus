import { EPOCH } from './ids'
import type { Snapshot } from './types'

/** Fecha desde la que la cuenta «Saldo inDrive» descuenta la comisión de los viajes (igual que la semilla de la BD). */
const INDRIVE_COMMISSION_SINCE = '2026-11-12'

/**
 * Catálogos iniciales para un almacén local que arranca sin ninguno (APK con SQLite, pruebas). Con el backend nunca se usan:
 * la base ya trae las mismas semillas y `init()` solo siembra si no existe ninguna entrada.
 */
export const SEED_CATALOGS: Pick<Snapshot, 'accounts' | 'paymentMethods' | 'movementTypes' | 'fundMovementTypes' | 'expenseCategories' | 'rateModes'> = {
  accounts: [
    { id: 'caja', name: 'Caja', initialBalance: 0, isCashBox: true, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'transferencias', name: 'Nequi', initialBalance: 0, isCashBox: false, sortOrder: 1, active: true, updatedAt: EPOCH },
    { id: 'deposito', name: 'Depósito', initialBalance: 0, isCashBox: false, sortOrder: 2, active: true, updatedAt: EPOCH },
    { id: 'bancolombia', name: 'Bancolombia', initialBalance: 0, isCashBox: false, sortOrder: 4, active: true, updatedAt: EPOCH },
    { id: 'indrive', name: 'Saldo inDrive', initialBalance: 0, isCashBox: false, sortOrder: 5, active: true, commissionSince: INDRIVE_COMMISSION_SINCE, updatedAt: EPOCH },
  ],
  paymentMethods: [
    { id: 'cash', name: 'Efectivo', accountId: 'caja', affectsCash: true, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'transfer', name: 'Nequi', accountId: 'transferencias', affectsCash: false, sortOrder: 1, active: true, updatedAt: EPOCH },
    { id: 'bancolombia', name: 'Bancolombia', accountId: 'bancolombia', affectsCash: false, sortOrder: 3, active: true, updatedAt: EPOCH },
  ],
  movementTypes: [
    { id: 'expense', name: 'Gasto', sign: -1, hasCategory: true, requiresDestination: false, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'withdrawal', name: 'Retiro', sign: -1, hasCategory: false, requiresDestination: false, sortOrder: 1, active: true, updatedAt: EPOCH },
    { id: 'deposit', name: 'Aporte', sign: 1, hasCategory: false, requiresDestination: false, sortOrder: 2, active: true, updatedAt: EPOCH },
    { id: 'traslado', name: 'Traslado', sign: -1, hasCategory: false, requiresDestination: true, sortOrder: 3, active: true, updatedAt: EPOCH },
  ],
  fundMovementTypes: [
    { id: 'transfer', name: 'Envío', sign: 1, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'spend', name: 'Gasto', sign: -1, sortOrder: 1, active: true, updatedAt: EPOCH },
  ],
  expenseCategories: [
    { id: 'comida', name: 'Comida', sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'parqueadero', name: 'Parqueadero', sortOrder: 1, active: true, updatedAt: EPOCH },
    { id: 'varios', name: 'Varios', sortOrder: 2, active: true, updatedAt: EPOCH },
  ],
  rateModes: [
    { id: 'direct', name: 'Valor por km', usesRatePerKm: true, usesCostInterval: false, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'derived', name: 'Costo total cada X km', usesRatePerKm: false, usesCostInterval: true, sortOrder: 1, active: true, updatedAt: EPOCH },
  ],
}
