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
  const s = emptySnapshot()
  const t = now()
  const catId = new Map<number, string>()

  for (const c of old?.categories ?? []) {
    const id = seededCategoryId(String(c.name)) ?? `cat-legacy-${c.id}`
    catId.set(Number(c.id), id)
    s.categories.push({ ...c, id, updatedAt: t })
  }
  const mapCat = (n: unknown) => catId.get(Number(n)) ?? `cat-legacy-${n}`

  for (const d of Object.values<any>(old?.days ?? {})) {
    s.days.push({
      id: d.date, date: d.date, km: d.km ?? 0, note: d.note, updatedAt: t,
      costs: (d.costs ?? []).map((c: any) => ({ ...c, categoryId: mapCat(c.categoryId) })),
    })
    for (const sv of d.services ?? []) {
      s.services.push({ id: newId(), date: d.date, amount: sv.amount, method: sv.method ?? 'cash', note: sv.note, updatedAt: t })
    }
  }

  for (const c of Object.values<any>(old?.cash ?? {})) {
    s.cash.push({ id: c.date, date: c.date, opening: c.opening, openedAt: c.openedAt, closedAt: c.closedAt, counted: c.counted, updatedAt: t })
    for (const m of c.movements ?? []) {
      s.movements.push({ id: newId(), date: c.date, type: m.type, amount: m.amount, note: m.note, updatedAt: t })
    }
  }
  return s
}
