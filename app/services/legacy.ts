import { newId, now } from './ids'
import { emptySnapshot, type Snapshot } from './types'

/** Id fijo para las categorías sembradas, igual en todos los dispositivos. */
export function seededCategoryId(name: string): string | null {
  if (/^gasolina$/i.test(name.trim())) return 'cat-gasolina'
  if (/^servicio moto$/i.test(name.trim())) return 'cat-servicio-moto'
  return null
}

/** Convierte el formato anterior (ids numéricos, días con servicios anidados) al de registros con id único. */
export function fromLegacy(old: any): Snapshot {
  const snapshot = emptySnapshot()
  const timestamp = now()
  const categoryIdByLegacyId = new Map<number, string>()

  for (const category of old?.categories ?? []) {
    const id = seededCategoryId(String(category.name)) ?? `cat-legacy-${category.id}`
    categoryIdByLegacyId.set(Number(category.id), id)
    snapshot.categories.push({ ...category, id, updatedAt: timestamp })
  }
  const mapCategoryId = (legacyId: unknown) => categoryIdByLegacyId.get(Number(legacyId)) ?? `cat-legacy-${legacyId}`

  for (const day of Object.values<any>(old?.days ?? {})) {
    snapshot.days.push({
      id: day.date, date: day.date, km: day.km ?? 0, note: day.note, updatedAt: timestamp,
      costs: (day.costs ?? []).map((cost: any) => ({ ...cost, categoryId: mapCategoryId(cost.categoryId) })),
    })
    for (const service of day.services ?? []) {
      snapshot.services.push({ id: newId(), date: day.date, amount: service.amount, method: service.method ?? 'cash', note: service.note, updatedAt: timestamp })
    }
  }

  for (const cashDay of Object.values<any>(old?.cash ?? {})) {
    snapshot.cash.push({ id: cashDay.date, date: cashDay.date, opening: cashDay.opening, openedAt: cashDay.openedAt, closedAt: cashDay.closedAt, counted: cashDay.counted, updatedAt: timestamp })
    for (const movement of cashDay.movements ?? []) {
      snapshot.movements.push({ id: newId(), date: cashDay.date, type: movement.type, amount: movement.amount, note: movement.note, updatedAt: timestamp })
    }
  }
  return snapshot
}
