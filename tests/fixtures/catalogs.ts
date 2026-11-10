import type { Catalogs } from '../../app/services/types'

/** Catálogos de prueba con la misma forma que las semillas del backend. */
export const testCatalogs = (): Catalogs => ({
  paymentMethods: [
    { id: 'cash', name: 'Efectivo', affectsCash: true, sortOrder: 0, active: true },
    { id: 'transfer', name: 'Transferencia', affectsCash: false, sortOrder: 1, active: true },
  ],
  movementTypes: [
    { id: 'expense', name: 'Gasto', sign: -1, hasCategory: true, sortOrder: 0, active: true },
    { id: 'withdrawal', name: 'Retiro', sign: -1, hasCategory: false, sortOrder: 1, active: true },
    { id: 'deposit', name: 'Aporte', sign: 1, hasCategory: false, sortOrder: 2, active: true },
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
