/** Mapeo puro de datos de estadísticas a las series que dibujan las gráficas (sin E/S ni ECharts). */
import type { DayRecord, PaymentMethod } from '../services/types'
import { dayActivity, type ActivityShift } from './activity'
import type { Bucket } from './stats'
import { tripTotal } from './trip'

export const COMMISSION_SERIES = 'Comisión inDrive + IVA'
export const EXPENSES_SERIES = 'Gastos varios'

export interface ActivityTripBar {
  tripId: string
  startMinute: number
  /** Puede superar 1440 si cruza la medianoche. */
  endMinute: number
  minutes: number
  /** Viaje + bonus. */
  amount: number
}

export interface ActivityGapBar {
  startMinute: number
  endMinute: number
  minutes: number
}

export interface ActivityRow {
  date: string
  trips: ActivityTripBar[]
  /** Huecos: dentro de turnos si el día tiene turnos; entre viajes si no. */
  gaps: ActivityGapBar[]
  /** Bandas de turno (unión, sin solapes); vacío si el día no tiene turnos. */
  shifts: ActivityGapBar[]
  hasShifts: boolean
  /** Viajes total o parcialmente fuera de turno. */
  outOfShiftTripIds: string[]
}

/** Día con turnos opcionales (`shifts` aún no está en DayRecord). */
export type ActivityDay = DayRecord & { shifts?: ActivityShift[] }

export interface VisibleRange {
  startMinute: number
  endMinute: number
}

const FULL_DAY_RANGE: VisibleRange = { startMinute: 0, endMinute: 1440 }
const RANGE_MARGIN_MINUTES = 30

/** Minuto del día (admite > 1440) como HH:MM. */
export function formatClock(minute: number): string {
  const wrapped = Math.round(minute) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/** Una fila por día trabajado (con horarios), en orden cronológico; `latest` deja solo el último. */
export function buildActivityRows(days: ActivityDay[], mode: 'all' | 'latest', now?: string): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const day of [...days].sort((first, second) => first.date.localeCompare(second.date))) {
    const activity = dayActivity(day.services, day.shifts ?? [], now)
    if (!activity.segments.length && !activity.hasShifts) continue
    const amounts = new Map(day.services.map((service, index) => [service.id ?? String(index), tripTotal(service)]))
    rows.push({
      date: day.date,
      trips: activity.segments.map(segment => ({
        tripId: segment.tripId,
        startMinute: segment.startMinute,
        endMinute: segment.endMinute,
        minutes: segment.endMinute - segment.startMinute,
        amount: amounts.get(segment.tripId) ?? 0,
      })),
      gaps: activity.gaps.map(gap => ({ ...gap, minutes: gap.endMinute - gap.startMinute })),
      shifts: activity.shiftIntervals.map(shift => ({ ...shift, minutes: shift.endMinute - shift.startMinute })),
      hasShifts: activity.hasShifts,
      outOfShiftTripIds: activity.outOfShiftTrips,
    })
  }
  return mode === 'latest' ? rows.slice(-1) : rows
}

/**
 * Rango del eje horario: mínimo/máximo de turnos y viajes de las filas, con 30 min de margen redondeado a la hora
 * (inicio hacia abajo, fin hacia arriba; inicio >= 0). Sin filas, el día completo 0–1440.
 */
export function computeVisibleRange(rows: ActivityRow[]): VisibleRange {
  const bars = rows.flatMap(row => [...row.trips, ...row.shifts])
  if (!bars.length) return { ...FULL_DAY_RANGE }
  const first = Math.min(...bars.map(bar => bar.startMinute))
  const last = Math.max(...bars.map(bar => bar.endMinute))
  return {
    startMinute: Math.max(0, Math.floor((first - RANGE_MARGIN_MINUTES) / 60) * 60),
    endMinute: Math.ceil((last + RANGE_MARGIN_MINUTES) / 60) * 60,
  }
}

export interface CostSeries {
  labels: string[]
  series: { name: string; data: number[] }[]
}

/** Costos por categoría (unión de todos los periodos) + comisión + gastos varios, alineados a `labels`. */
export function buildCostSeries(buckets: Bucket[]): CostSeries {
  const categoryNames = new Map<string, string>()
  for (const bucket of buckets) for (const [categoryId, cost] of bucket.costs) if (!categoryNames.has(categoryId)) categoryNames.set(categoryId, cost.name)
  const series = [...categoryNames].map(([categoryId, name]) => ({
    name,
    data: buckets.map(bucket => bucket.costs.get(categoryId)?.amount ?? 0),
  }))
  series.push({ name: COMMISSION_SERIES, data: buckets.map(bucket => bucket.commission) })
  series.push({ name: EXPENSES_SERIES, data: buckets.map(bucket => bucket.expenses) })
  return { labels: buckets.map(bucket => bucket.key), series }
}

export interface IncomeSeries {
  id: string
  name: string
  data: number[]
}

/**
 * Ingresos por medio de pago alineados a los periodos: un medio del catálogo aparece si está activo o si tiene ingresos
 * (orden del catálogo); los códigos con ingresos que aún no están en el catálogo van al final con el código como nombre.
 */
export function buildIncomeSeries(buckets: Bucket[], paymentMethods: PaymentMethod[]): IncomeSeries[] {
  const seriesFor = (id: string, name: string): IncomeSeries => ({ id, name, data: buckets.map(bucket => bucket.incomeByMethod.get(id) ?? 0) })
  const hasIncome = (id: string) => buckets.some(bucket => (bucket.incomeByMethod.get(id) ?? 0) !== 0)
  const known = new Set(paymentMethods.map(method => method.id))
  const fromCatalog = [...paymentMethods]
    .sort((first, second) => first.sortOrder - second.sortOrder || first.name.localeCompare(second.name))
    .filter(method => method.active || hasIncome(method.id))
    .map(method => seriesFor(method.id, method.name))
  const unknownIds = new Set(buckets.flatMap(bucket => [...bucket.incomeByMethod.keys()]).filter(id => id && !known.has(id)))
  return [...fromCatalog, ...[...unknownIds].map(id => seriesFor(id, id))]
}
