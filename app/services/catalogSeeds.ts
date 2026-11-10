import { EPOCH } from './ids'
import type { Snapshot } from './types'

/**
 * Catálogos iniciales para un almacén local que arranca sin ninguno (APK con SQLite, pruebas). Con el backend nunca se usan:
 * la base ya trae las mismas semillas y `init()` solo siembra si no existe ninguna entrada.
 */
export const SEED_CATALOGS: Pick<Snapshot, 'paymentMethods' | 'movementTypes' | 'fundMovementTypes' | 'expenseCategories' | 'rateModes'> = {
  paymentMethods: [
    { id: 'cash', name: 'Efectivo', affectsCash: true, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'transfer', name: 'Transferencia', affectsCash: false, sortOrder: 1, active: true, updatedAt: EPOCH },
  ],
  movementTypes: [
    { id: 'expense', name: 'Gasto', sign: -1, hasCategory: true, sortOrder: 0, active: true, updatedAt: EPOCH },
    { id: 'withdrawal', name: 'Retiro', sign: -1, hasCategory: false, sortOrder: 1, active: true, updatedAt: EPOCH },
    { id: 'deposit', name: 'Aporte', sign: 1, hasCategory: false, sortOrder: 2, active: true, updatedAt: EPOCH },
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
