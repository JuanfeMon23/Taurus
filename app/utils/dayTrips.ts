import { computeDay, type Category } from './calc'
import { formatDuration, sumDistance, tripMinutes, tripTotal } from './trip'
import type { Service } from '../services/types'

/** Lógica pura de los viajes de un día: alta/edición/baja, orden, totales y resumen para la lista. */

/** Agrega el viaje (sin id o con id desconocido) o reemplaza el que tiene el mismo id. No muta la lista. */
export function upsertTrip(list: Service[], trip: Service): Service[] {
  const i = trip.id ? list.findIndex(x => x.id === trip.id) : -1
  if (i < 0) return [...list, trip]
  return list.map((x, j) => (j === i ? trip : x))
}

export function removeTrip(list: Service[], id: string): Service[] {
  return list.filter(x => x.id !== id)
}

/** Por hora de recogida; los servicios sin hora quedan al final (orden estable). */
export function sortTrips(list: Service[]): Service[] {
  return [...list].sort((a, b) => {
    if (!a.startTime && !b.startTime) return 0
    if (!a.startTime) return 1
    if (!b.startTime) return -1
    return a.startTime.localeCompare(b.startTime)
  })
}

export interface DayTotals {
  count: number
  /** Suma de la distancia de los viajes. */
  tripKm: number
  /** Km totales del día (viajes + extra) con el que se calculan los costos. */
  km: number
  /** Bruto del día: dinero + bonus de los viajes. */
  gross: number
  /** Bonus total del día (ya incluido en el bruto). */
  bonus: number
  totalCost: number
  net: number
}

const clean = (n: number) => Math.round(n * 1e9) / 1e9

/** Km del día = distancia de los viajes + km extra (fuera de viajes; vacío/negativo cuenta 0). */
export function dayKm(trips: Service[], extraKm: number): number {
  const extra = Number.isFinite(extraKm) && extraKm > 0 ? extraKm : 0
  return clean(sumDistance(trips) + extra)
}

/** Km extra derivado del total guardado: max(0, total − suma de viajes). */
export function extraKmFrom(totalKm: number, trips: Service[]): number {
  return Math.max(0, clean(totalKm - sumDistance(trips)))
}

/** `km` es el total del día (viajes + extra), base de los costos. */
export function dayTotals(trips: Service[], km: number, categories: Category[]): DayTotals {
  const r = computeDay({ services: trips.map(tripTotal), km, categories })
  return { count: trips.length, tripKm: sumDistance(trips), km, gross: r.gross, bonus: clean(trips.reduce((s, x) => s + (tripTotal(x) - x.amount), 0)), totalCost: r.totalCost, net: r.net }
}

export function tripSummary(x: Service): { schedule: string; duration: string; route: string } {
  return {
    schedule: x.startTime && x.endTime ? `${x.startTime}–${x.endTime}` : '',
    duration: formatDuration(tripMinutes(x.startTime, x.endTime)),
    route: [x.origin, x.destination].filter(Boolean).join(' → '),
  }
}
