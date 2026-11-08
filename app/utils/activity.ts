/** Tiempo activo vs muerto del día a partir de las horas HH:MM de cada viaje y, si existen, de los turnos (puro, sin E/S). */
import { tripMinutes } from './trip'

export interface ActivityTrip {
  id?: string
  startTime?: string | null
  endTime?: string | null
}

/** Turno del día en HH:MM; puede cruzar la medianoche. `endTime` ausente = turno en curso. */
export interface ActivityShift {
  startTime?: string | null
  endTime?: string | null
}

export interface ActivitySegment {
  startMinute: number
  /** Puede superar 1440 si el viaje cruza la medianoche. */
  endMinute: number
  tripId: string
}

export interface ActivityGap {
  startMinute: number
  endMinute: number
}

export interface DayActivity {
  segments: ActivitySegment[]
  /** Unión de todos los viajes (cuentan también los que caen fuera de turno). */
  activeMinutes: number
  /** Con turnos: shiftMinutes. Sin turnos: primera recogida → última llegada. */
  spanMinutes: number
  /** Con turnos: shiftMinutes − activeInShiftMinutes. Sin turnos: spanMinutes − activeMinutes. */
  idleMinutes: number
  /** Con turnos: huecos solo dentro de turnos. Sin turnos: entre viajes. */
  gaps: ActivityGap[]
  longestGap: number
  /** Con turnos: activeInShiftMinutes / shiftMinutes. Sin turnos: activeMinutes / spanMinutes; 0 sin denominador. */
  utilization: number
  hasShifts: boolean
  /** Unión de turnos (disjuntos, ordenados; endMinute puede superar 1440). Vacío sin turnos. */
  shiftIntervals: ActivityGap[]
  shiftMinutes: number
  /** Parte de los viajes que cae dentro de turnos (0 sin turnos). */
  activeInShiftMinutes: number
  /** Ids de viajes total o parcialmente fuera de turno. Vacío sin turnos. */
  outOfShiftTrips: string[]
}

export interface PeriodActivity {
  /** Días con viajes con horas o con turnos. */
  workedDays: number
  /** Unión de viajes de cada día, sumada (incluye lo fuera de turno). */
  activeMinutes: number
  /** Suma de spanMinutes del día (turno si hay turnos, lapso si no). */
  spanMinutes: number
  /** Suma de idleMinutes del día. */
  idleMinutes: number
  avgActiveMinutes: number
  avgSpanMinutes: number
  avgIdleMinutes: number
  /** Activo efectivo (en turno si el día tiene turnos, total si no) / spanMinutes. */
  utilization: number
  shiftMinutes: number
  activeInShiftMinutes: number
  /** Días trabajados sin turnos registrados (usan el lapso primera recogida → última llegada). */
  daysWithoutShifts: number
  /** Viajes total o parcialmente fuera de turno en el periodo. */
  outOfShiftTripCount: number
  /** Minutos activos por hora del reloj 0–23 (en días con turnos, solo los dentro de turno). */
  hourlyActivity: number[]
  /** Minutos de turno por hora 0–23 (solo días con turnos); sirve para normalizar hourlyActivity. */
  hourlyShiftMinutes: number[]
  /**
   * Con horas de turno suficientes (>= MIN_SHIFT_MINUTES_FOR_BEST_HOUR acumulados): hora con mayor proporción
   * activo/turno. Si ninguna hora califica (p. ej. sin turnos): hora con más minutos activos. null sin actividad.
   */
  bestHour: number | null
}

const MINUTES_PER_DAY = 1440
export const MIN_SHIFT_MINUTES_FOR_BEST_HOUR = 30

const toStartMinute = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

const sumLength = (intervals: ActivityGap[]): number => intervals.reduce((total, block) => total + block.endMinute - block.startMinute, 0)

/** Une segmentos solapados o contiguos en intervalos disjuntos ordenados. */
function mergeSegments(segments: ActivityGap[]): ActivityGap[] {
  const merged: ActivityGap[] = []
  for (const segment of [...segments].sort((first, second) => first.startMinute - second.startMinute)) {
    const last = merged[merged.length - 1]
    if (last && segment.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, segment.endMinute)
    else merged.push({ startMinute: segment.startMinute, endMinute: segment.endMinute })
  }
  return merged
}

/** Intersección de dos listas de intervalos. */
function intersectIntervals(first: ActivityGap[], second: ActivityGap[]): ActivityGap[] {
  const result: ActivityGap[] = []
  for (const left of first) {
    for (const right of second) {
      const startMinute = Math.max(left.startMinute, right.startMinute)
      const endMinute = Math.min(left.endMinute, right.endMinute)
      if (endMinute > startMinute) result.push({ startMinute, endMinute })
    }
  }
  return result
}

/** Partes de `base` que no cubre `cover` (ambas disjuntas y ordenadas). */
function subtractIntervals(base: ActivityGap[], cover: ActivityGap[]): ActivityGap[] {
  const result: ActivityGap[] = []
  for (const block of base) {
    let cursor = block.startMinute
    for (const covered of cover) {
      if (covered.endMinute <= cursor || covered.startMinute >= block.endMinute) continue
      if (covered.startMinute > cursor) result.push({ startMinute: cursor, endMinute: covered.startMinute })
      cursor = Math.max(cursor, covered.endMinute)
    }
    if (cursor < block.endMinute) result.push({ startMinute: cursor, endMinute: block.endMinute })
  }
  return result
}

/**
 * Turnos → intervalos disjuntos. Cruzar medianoche suma 1440 al fin. Sin `endTime` (turno en curso) se cierra en
 * `now` (HH:MM); si no hay `now`, el turno se ignora. Turnos de duración 0 o con horas inválidas se ignoran.
 * Viajes y turnos comparten el marco del día (ambos pueden superar 1440).
 */
function buildShiftIntervals(shifts: ActivityShift[], now?: string): ActivityGap[] {
  const intervals: ActivityGap[] = []
  for (const shift of shifts) {
    const hasEnd = Boolean((shift.endTime ?? '').trim())
    const duration = tripMinutes(shift.startTime, hasEnd ? shift.endTime : now)
    if (duration === null || duration <= 0) continue
    const startMinute = toStartMinute((shift.startTime ?? '').trim())
    intervals.push({ startMinute, endMinute: startMinute + duration })
  }
  return mergeSegments(intervals)
}

export function dayActivity(trips: ActivityTrip[], shifts: ActivityShift[] = [], now?: string): DayActivity {
  const segments: ActivitySegment[] = []
  trips.forEach((trip, index) => {
    const duration = tripMinutes(trip.startTime, trip.endTime)
    if (duration === null) return
    const startMinute = toStartMinute((trip.startTime ?? '').trim())
    segments.push({ startMinute, endMinute: startMinute + duration, tripId: trip.id ?? String(index) })
  })
  segments.sort((first, second) => first.startMinute - second.startMinute)

  const shiftIntervals = buildShiftIntervals(shifts, now)
  const hasShifts = shiftIntervals.length > 0
  const merged = mergeSegments(segments)

  if (hasShifts) {
    const shiftMinutes = sumLength(shiftIntervals)
    const activeInShiftMinutes = sumLength(intersectIntervals(merged, shiftIntervals))
    const gaps = subtractIntervals(shiftIntervals, merged)
    const outOfShiftTrips = segments
      .filter(segment => sumLength(intersectIntervals([segment], shiftIntervals)) < segment.endMinute - segment.startMinute)
      .map(segment => segment.tripId)
    return {
      segments,
      activeMinutes: sumLength(merged),
      spanMinutes: shiftMinutes,
      idleMinutes: shiftMinutes - activeInShiftMinutes,
      gaps,
      longestGap: gaps.reduce((longest, gap) => Math.max(longest, gap.endMinute - gap.startMinute), 0),
      utilization: activeInShiftMinutes / shiftMinutes,
      hasShifts,
      shiftIntervals,
      shiftMinutes,
      activeInShiftMinutes,
      outOfShiftTrips,
    }
  }

  const noShifts = { hasShifts, shiftIntervals, shiftMinutes: 0, activeInShiftMinutes: 0, outOfShiftTrips: [] as string[] }
  if (!segments.length) return { segments, activeMinutes: 0, spanMinutes: 0, idleMinutes: 0, gaps: [], longestGap: 0, utilization: 0, ...noShifts }
  const activeMinutes = sumLength(merged)
  const spanMinutes = merged[merged.length - 1]!.endMinute - merged[0]!.startMinute
  const gaps = merged.slice(1).map((block, index) => ({ startMinute: merged[index]!.endMinute, endMinute: block.startMinute }))
  return {
    segments,
    activeMinutes,
    spanMinutes,
    idleMinutes: spanMinutes - activeMinutes,
    gaps,
    longestGap: gaps.reduce((longest, gap) => Math.max(longest, gap.endMinute - gap.startMinute), 0),
    utilization: spanMinutes > 0 ? activeMinutes / spanMinutes : 0,
    ...noShifts,
  }
}

/** Suma los minutos de cada intervalo a su hora del reloj (lo que pasa de medianoche vuelve a la hora 0). */
function addToHours(hours: number[], intervals: ActivityGap[]): void {
  for (const block of intervals) {
    let minute = block.startMinute
    while (minute < block.endMinute) {
      const chunkEnd = Math.min((Math.floor(minute / 60) + 1) * 60, block.endMinute)
      const hour = Math.floor((minute % MINUTES_PER_DAY) / 60)
      hours[hour] = (hours[hour] ?? 0) + chunkEnd - minute
      minute = chunkEnd
    }
  }
}

function pickBestHour(hourlyActivity: number[], hourlyShiftMinutes: number[]): number | null {
  let bestHour: number | null = null
  let bestRatio = 0
  hourlyShiftMinutes.forEach((shiftMinutes, hour) => {
    const active = hourlyActivity[hour] ?? 0
    if (shiftMinutes < MIN_SHIFT_MINUTES_FOR_BEST_HOUR || active <= 0) return
    const ratio = active / shiftMinutes
    if (ratio > bestRatio) {
      bestHour = hour
      bestRatio = ratio
    }
  })
  if (bestHour !== null) return bestHour
  const peak = Math.max(...hourlyActivity)
  return peak > 0 ? hourlyActivity.indexOf(peak) : null
}

export function periodActivity(days: DayActivity[]): PeriodActivity {
  const worked = days.filter(day => day.segments.length > 0 || day.hasShifts)
  const effectiveActive = (day: DayActivity): number => (day.hasShifts ? day.activeInShiftMinutes : day.activeMinutes)
  const activeMinutes = worked.reduce((total, day) => total + day.activeMinutes, 0)
  const spanMinutes = worked.reduce((total, day) => total + day.spanMinutes, 0)
  const idleMinutes = worked.reduce((total, day) => total + day.idleMinutes, 0)
  const hourlyActivity = Array.from({ length: 24 }, () => 0)
  const hourlyShiftMinutes = Array.from({ length: 24 }, () => 0)
  for (const day of worked) {
    const merged = mergeSegments(day.segments)
    if (day.hasShifts) {
      addToHours(hourlyActivity, intersectIntervals(merged, day.shiftIntervals))
      addToHours(hourlyShiftMinutes, day.shiftIntervals)
    } else {
      addToHours(hourlyActivity, merged)
    }
  }
  const count = worked.length
  return {
    workedDays: count,
    activeMinutes,
    spanMinutes,
    idleMinutes,
    avgActiveMinutes: count ? activeMinutes / count : 0,
    avgSpanMinutes: count ? spanMinutes / count : 0,
    avgIdleMinutes: count ? idleMinutes / count : 0,
    utilization: spanMinutes > 0 ? worked.reduce((total, day) => total + effectiveActive(day), 0) / spanMinutes : 0,
    shiftMinutes: worked.reduce((total, day) => total + day.shiftMinutes, 0),
    activeInShiftMinutes: worked.reduce((total, day) => total + day.activeInShiftMinutes, 0),
    daysWithoutShifts: worked.filter(day => !day.hasShifts).length,
    outOfShiftTripCount: worked.reduce((total, day) => total + day.outOfShiftTrips.length, 0),
    hourlyActivity,
    hourlyShiftMinutes,
    bestHour: pickBestHour(hourlyActivity, hourlyShiftMinutes),
  }
}
