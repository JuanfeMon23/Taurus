/** Lógica pura de catálogos (medios de pago, tipos de movimiento, categorías de gasto). Los datos viven en BD, no aquí. */
import type { CatalogEntry, CatalogKind, MovementTypeEntry, PaymentMethod, SignedEntry, Snapshot } from '../services/types'

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

/** Signo del tipo (+1 suma, −1 resta). Regla segura: un código que no está en el catálogo vale 0 y no mueve nada. */
export const movementSign = (types: SignedEntry[], code: string): 1 | -1 | 0 => types.find(type => type.id === code)?.sign ?? 0

/** ¿El tipo lleva categoría de gasto (y cuenta en «Gastos varios»)? Un código que no está en el catálogo no la lleva. */
export const movementTypeHasCategory = (types: MovementTypeEntry[], code: string): boolean => types.find(type => type.id === code)?.hasCategory ?? false

/** ¿Algún registro vivo usa este código? Si sí, la entrada solo se puede desactivar, no borrar. */
export function catalogEntryInUse(snapshot: Pick<Snapshot, 'services' | 'movements' | 'fundMovements'>, kind: CatalogKind, id: string): boolean {
  const alive = <Record extends { deleted?: boolean }>(records: Record[]) => records.filter(record => !record.deleted)
  switch (kind) {
    case 'paymentMethods':
      return alive(snapshot.services).some(service => service.method === id) || alive(snapshot.movements).some(movement => movement.method === id)
    case 'movementTypes':
      return alive(snapshot.movements).some(movement => movement.type === id)
    case 'fundMovementTypes':
      return alive(snapshot.fundMovements).some(movement => movement.type === id)
    case 'expenseCategories':
      return alive(snapshot.movements).some(movement => movement.categoryId === id)
  }
}
