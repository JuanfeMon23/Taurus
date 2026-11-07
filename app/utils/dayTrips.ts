import { computeDay, type Category } from './calc'
import { dayNet, sumCommission } from './commission'
import { formatDuration, sumDistance, tripMinutes, tripTotal } from './trip'
import type { Service } from '../services/types'

/** Lógica pura de los viajes de un día: alta/edición/baja, orden, totales y resumen para la lista. */

/** Agrega el viaje (sin id o con id desconocido) o reemplaza el que tiene el mismo id. No muta la lista. */
export function upsertTrip(list: Service[], trip: Service): Service[] {
  const existingIndex = trip.id ? list.findIndex(item => item.id === trip.id) : -1
  if (existingIndex < 0) return [...list, trip]
  return list.map((item, index) => (index === existingIndex ? trip : item))
}

export function removeTrip(list: Service[], id: string): Service[] {
  return list.filter(item => item.id !== id)
}

/** Por hora de recogida descendente (el último viaje primero); los servicios sin hora quedan al final (orden estable). */
export function sortTrips(list: Service[]): Service[] {
  return [...list].sort((first, second) => {
    if (!first.startTime && !second.startTime) return 0
    if (!first.startTime) return 1
    if (!second.startTime) return -1
    return second.startTime.localeCompare(first.startTime)
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
  /** Comisión inDrive del día e IVA de esa comisión. */
  commission: number
  commissionVat: number
  /** Neto = bruto − costos por km − comisión − IVA. */
  net: number
}

const clean = (value: number) => Math.round(value * 1e9) / 1e9

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
  const dayResult = computeDay({ services: trips.map(tripTotal), km, categories })
  const { commission, commissionVat } = sumCommission(trips)
  return {
    count: trips.length, tripKm: sumDistance(trips), km, gross: dayResult.gross,
    bonus: clean(trips.reduce((total, trip) => total + (tripTotal(trip) - trip.amount), 0)),
    totalCost: dayResult.totalCost, commission, commissionVat,
    net: dayNet(dayResult.gross, dayResult.totalCost, commission, commissionVat),
  }
}

export function tripSummary(trip: Service): { schedule: string; duration: string; route: string } {
  return {
    schedule: trip.startTime && trip.endTime ? `${trip.startTime}–${trip.endTime}` : '',
    duration: formatDuration(tripMinutes(trip.startTime, trip.endTime)),
    route: [trip.origin, trip.destination].filter(Boolean).join(' → '),
  }
}
