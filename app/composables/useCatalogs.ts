import { emptyCatalogs, type Catalogs } from '../services/types'
import { activeEntries, defaultMethodId } from '../utils/catalogs'

/**
 * Catálogos (medios de pago, tipos de movimiento, categorías de gasto) compartidos por todas las pantallas.
 * Cada pantalla llama a `refreshCatalogs()` al montarse y al reactivarse (KeepAlive) para ver lo editado en Tarifas.
 */
export function useCatalogs() {
  const catalogs = useState<Catalogs>('catalogs', emptyCatalogs)

  async function refreshCatalogs() {
    catalogs.value = await (await useTaurus()).repo.listCatalogs()
  }

  return {
    catalogs,
    refreshCatalogs,
    activeMethods: computed(() => activeEntries(catalogs.value.paymentMethods)),
    activeMovementTypes: computed(() => activeEntries(catalogs.value.movementTypes)),
    activeFundTypes: computed(() => activeEntries(catalogs.value.fundMovementTypes)),
    activeExpenseCategories: computed(() => activeEntries(catalogs.value.expenseCategories)),
    defaultMethod: computed(() => defaultMethodId(catalogs.value.paymentMethods) ?? ''),
  }
}
