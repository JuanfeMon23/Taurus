/** Lógica pura de viajes: duración, validación de una fila y suma de distancias. */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function toMinutes(t: string | null | undefined): number | null {
  const m = HHMM.exec((t ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Minutos entre dos horas HH:MM; si el fin es menor que el inicio, cruza la medianoche. Null si falta o es inválida. */
export function tripMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  const a = toMinutes(start)
  const b = toMinutes(end)
  if (a === null || b === null) return null
  return b >= a ? b - a : b + 24 * 60 - a
}

/** "45 min", "1 h", "1 h 05 min"; vacío si no hay duración. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return ''
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`
}

export interface TripFields {
  startTime?: string | null
  endTime?: string | null
  distanceKm?: number | null
  amount?: number | null
  /** Propina u otro extra además del dinero del viaje; opcional, ≥ 0. */
  bonus?: number | null
  origin?: string | null
  destination?: string | null
}

export type TripErrors = Partial<Record<'startTime' | 'endTime' | 'distanceKm' | 'amount' | 'bonus', string>>

const blank = (v: unknown) => v === null || v === undefined || v === ''

/** Errores legibles por campo; objeto vacío = fila válida. Obligatorios: inicio, fin, distancia ≥ 0 y monto > 0. */
export function validateTrip(t: TripFields): TripErrors {
  const e: TripErrors = {}
  if (blank(t.startTime)) e.startTime = 'Falta la hora de recogida'
  else if (toMinutes(t.startTime) === null) e.startTime = 'Hora de recogida inválida'
  if (blank(t.endTime)) e.endTime = 'Falta la hora de llegada'
  else if (toMinutes(t.endTime) === null) e.endTime = 'Hora de llegada inválida'
  if (blank(t.distanceKm) || typeof t.distanceKm !== 'number' || !Number.isFinite(t.distanceKm)) e.distanceKm = 'Falta la distancia'
  else if (t.distanceKm < 0) e.distanceKm = 'La distancia no puede ser negativa'
  if (blank(t.amount) || typeof t.amount !== 'number' || !Number.isFinite(t.amount)) e.amount = 'Falta el monto'
  else if (t.amount <= 0) e.amount = 'El monto debe ser mayor que cero'
  if (!blank(t.bonus)) {
    if (typeof t.bonus !== 'number' || !Number.isFinite(t.bonus)) e.bonus = 'Bonus inválido'
    else if (t.bonus < 0) e.bonus = 'El bonus no puede ser negativo'
  }
  return e
}

/** Total que deja el viaje: dinero + bonus (ausente cuenta 0). */
export const tripTotal = (t: { amount: number; bonus?: number | null }): number =>
  t.amount + (typeof t.bonus === 'number' && Number.isFinite(t.bonus) && t.bonus > 0 ? t.bonus : 0)

/** Suma de distancias de las filas que la tienen (ignora vacías y negativas). */
export function sumDistance(rows: { distanceKm?: number | null }[]): number {
  const total = rows.reduce((t, r) => (typeof r.distanceKm === 'number' && r.distanceKm > 0 ? t + r.distanceKm : t), 0)
  return Math.round(total * 1000) / 1000
}

/** Un servicio sin ningún dato de viaje (anterior a esta función) se muestra y guarda tal cual. */
export const hasTripData = (t: Pick<TripFields, 'startTime' | 'endTime' | 'distanceKm' | 'origin' | 'destination'>) =>
  !blank(t.startTime) || !blank(t.endTime) || !blank(t.distanceKm) || !blank(t.origin) || !blank(t.destination)
