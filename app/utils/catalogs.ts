/** Lógica pura de catálogos (medios de pago, tipos de movimiento, categorías de gasto). Los datos viven en BD, no aquí. */
import type { Account, CatalogEntry, CatalogKind, MovementTypeEntry, PaymentMethod, SignedEntry, Snapshot } from '../services/types'

/** Orden de presentación: `sortOrder` y luego nombre. Devuelve una copia. */
export const sortCatalog = <Entry extends CatalogEntry>(entries: Entry[]): Entry[] =>
  [...entries].sort((first, second) => first.sortOrder - second.sortOrder || first.name.localeCompare(second.name))

export const activeEntries = <Entry extends CatalogEntry>(entries: Entry[]): Entry[] => sortCatalog(entries.filter(entry => entry.active))

/** Nombre de la entrada; si el código aún no está en el catálogo (sync pendiente) se muestra el propio código. */
export function entryName(entries: CatalogEntry[], id: string | undefined, fallback = id ?? ''): string {
  return entries.find(entry => entry.id === id)?.name ?? fallback
}

/** Código estable a partir de un nombre: minúsculas, sin tildes, guiones entre palabras. Vacío si no queda nada. */
export function slugifyCode(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Medio de pago por defecto: el primero activo del catálogo. */
export const defaultMethodId = (methods: PaymentMethod[]): string | undefined => activeEntries(methods)[0]?.id

/**
 * ¿El medio mueve el efectivo de la caja? Sin código se usa el medio por defecto.
 * Regla segura: un código que no está en el catálogo (el sync aún no lo trajo) o un catálogo vacío cuentan como efectivo.
 */
export function methodAffectsCash(methods: PaymentMethod[], code: string | undefined): boolean {
  const id = code ?? defaultMethodId(methods)
  if (id === undefined) return true
  return methods.find(method => method.id === id)?.affectsCash ?? true
}

/** Cuenta que es la caja física (la del ciclo diario); undefined si el catálogo aún no trae cuentas. */
export const cashBoxAccountId = (accounts: Account[]): string | undefined => accounts.find(account => account.isCashBox)?.id

/** ¿La cuenta es la caja física? Regla segura (igual que los medios): sin código, o un código que no está en el catálogo, cuenta como caja. */
export function accountIsCashBox(accounts: Account[], accountId: string | undefined): boolean {
  if (accountId === undefined) return true
  return accounts.find(account => account.id === accountId)?.isCashBox ?? true
}

/** Cuenta a la que lleva su dinero un medio de pago; sin código se usa el medio por defecto. undefined si el medio no está en el catálogo. */
export const methodAccountId = (methods: PaymentMethod[], code: string | undefined): string | undefined =>
  methods.find(method => method.id === (code ?? defaultMethodId(methods)))?.accountId

/** Cuenta de origen de un movimiento: la suya o, en datos viejos (solo `method`), la de su medio de pago; si no hay, la caja. */
export const movementAccountId = (movement: { accountId?: string; method?: string }, catalogs: { accounts: Account[]; paymentMethods: PaymentMethod[] }): string | undefined =>
  movement.accountId ?? methodAccountId(catalogs.paymentMethods, movement.method) ?? cashBoxAccountId(catalogs.accounts)

/** ¿El tipo pide cuenta de destino (traslado)? Un código que no está en el catálogo no la pide. */
export const movementTypeRequiresDestination = (types: MovementTypeEntry[], code: string): boolean => types.find(type => type.id === code)?.requiresDestination ?? false

/** Signo del tipo (+1 suma, −1 resta). Regla segura: un código que no está en el catálogo vale 0 y no mueve nada. */
export const movementSign = (types: SignedEntry[], code: string): 1 | -1 | 0 => types.find(type => type.id === code)?.sign ?? 0

/** ¿El tipo lleva categoría de gasto (y cuenta en «Gastos varios»)? Un código que no está en el catálogo no la lleva. */
export const movementTypeHasCategory = (types: MovementTypeEntry[], code: string): boolean => types.find(type => type.id === code)?.hasCategory ?? false

/** ¿Algún registro vivo usa este código? Si sí, la entrada solo se puede desactivar, no borrar. */
export function catalogEntryInUse(snapshot: Pick<Snapshot, 'services' | 'movements' | 'fundMovements' | 'categories' | 'paymentMethods'>, kind: CatalogKind, id: string): boolean {
  const alive = <Record extends { deleted?: boolean }>(records: Record[]) => records.filter(record => !record.deleted)
  switch (kind) {
    case 'accounts':
      return alive(snapshot.movements).some(movement => movement.accountId === id || movement.toAccountId === id) || alive(snapshot.paymentMethods).some(method => method.accountId === id)
    case 'paymentMethods':
      return alive(snapshot.services).some(service => service.method === id) || alive(snapshot.movements).some(movement => movement.method === id)
    case 'movementTypes':
      return alive(snapshot.movements).some(movement => movement.type === id)
    case 'fundMovementTypes':
      return alive(snapshot.fundMovements).some(movement => movement.type === id)
    case 'expenseCategories':
      return alive(snapshot.movements).some(movement => movement.categoryId === id)
    case 'rateModes':
      return alive(snapshot.categories).some(category => category.rateMode === id)
  }
}

/** Códigos de catálogo que cada colección de registros guarda (sin llave foránea); el backend los valida en el PUT. */
const CATALOG_REFERENCES: { collection: 'categories' | 'services' | 'movements' | 'fundMovements' | 'paymentMethods'; field: string; kind: CatalogKind }[] = [
  { collection: 'categories', field: 'rateMode', kind: 'rateModes' },
  { collection: 'services', field: 'method', kind: 'paymentMethods' },
  { collection: 'movements', field: 'accountId', kind: 'accounts' },
  { collection: 'movements', field: 'toAccountId', kind: 'accounts' },
  { collection: 'paymentMethods', field: 'accountId', kind: 'accounts' },
  { collection: 'movements', field: 'type', kind: 'movementTypes' },
  { collection: 'movements', field: 'categoryId', kind: 'expenseCategories' },
  { collection: 'fundMovements', field: 'type', kind: 'fundMovementTypes' },
]

/**
 * Cambios a enviar en un mismo PUT: los registros sucios más las entradas de catálogo que usan y que ya existen en el estado local
 * (el backend rechaza con 422 un código que no conoce, y el catálogo y el registro pueden ir juntos en cualquier orden).
 * Lo que ya viaja en `changes` no se repite.
 */
export function withReferencedCatalogs(state: Snapshot, changes: Partial<Snapshot>): Partial<Snapshot> {
  const result: Partial<Snapshot> = { ...changes }
  for (const { collection, field, kind } of CATALOG_REFERENCES) {
    for (const record of (changes[collection] ?? []) as unknown as Record<string, unknown>[]) {
      const code = record[field]
      if (record.deleted || typeof code !== 'string') continue
      const sending = (result[kind] ?? []) as { id: string }[]
      if (sending.some(entry => entry.id === code)) continue
      const entry = (state[kind] as { id: string }[]).find(candidate => candidate.id === code)
      if (entry) (result as Record<string, unknown>)[kind] = [...sending, entry]
    }
  }
  return result
}
