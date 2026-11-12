import type { Catalogs } from '../../app/services/types'

/** Catálogos de prueba con la misma forma que las semillas del backend. */
export const testCatalogs = (): Catalogs => ({
  accounts: [
    { id: 'caja', name: 'Caja', initialBalance: 0, isCashBox: true, sortOrder: 0, active: true },
    { id: 'transferencias', name: 'Nequi', initialBalance: 0, isCashBox: false, sortOrder: 1, active: true },
    { id: 'deposito', name: 'Depósito', initialBalance: 0, isCashBox: false, sortOrder: 2, active: true },
    { id: 'bancolombia', name: 'Bancolombia', initialBalance: 0, isCashBox: false, sortOrder: 4, active: true },
    { id: 'indrive', name: 'Saldo inDrive', initialBalance: 0, isCashBox: false, sortOrder: 5, active: true, commissionSince: '2026-11-12' },
  ],
  paymentMethods: [
    { id: 'cash', name: 'Efectivo', accountId: 'caja', affectsCash: true, sortOrder: 0, active: true },
    { id: 'transfer', name: 'Nequi', accountId: 'transferencias', affectsCash: false, sortOrder: 1, active: true },
    { id: 'bancolombia', name: 'Bancolombia', accountId: 'bancolombia', affectsCash: false, sortOrder: 3, active: true },
  ],
  movementTypes: [
    { id: 'expense', name: 'Gasto', sign: -1, hasCategory: true, requiresDestination: false, sortOrder: 0, active: true },
    { id: 'withdrawal', name: 'Retiro', sign: -1, hasCategory: false, requiresDestination: false, sortOrder: 1, active: true },
    { id: 'deposit', name: 'Aporte', sign: 1, hasCategory: false, requiresDestination: false, sortOrder: 2, active: true },
    { id: 'traslado', name: 'Traslado', sign: -1, hasCategory: false, requiresDestination: true, sortOrder: 3, active: true },
  ],
  fundMovementTypes: [
    { id: 'transfer', name: 'Envío', sign: 1, sortOrder: 0, active: true },
    { id: 'spend', name: 'Gasto', sign: -1, sortOrder: 1, active: true },
  ],
  expenseCategories: [
    { id: 'comida', name: 'Comida', sortOrder: 0, active: true },
    { id: 'parqueadero', name: 'Parqueadero', sortOrder: 1, active: true },
    { id: 'varios', name: 'Varios', sortOrder: 2, active: true },
  ],
  rateModes: [
    { id: 'direct', name: 'Valor por km', usesRatePerKm: true, usesCostInterval: false, sortOrder: 0, active: true },
    { id: 'derived', name: 'Costo total cada X km', usesRatePerKm: false, usesCostInterval: true, sortOrder: 1, active: true },
  ],
})
