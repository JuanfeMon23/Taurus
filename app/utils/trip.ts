/** Lógica pura de viajes: duración, validación de una fila y suma de distancias. */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function toMinutes(time: string | null | undefined): number | null {
  const match = HHMM.exec((time ?? '').trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Minutos entre dos horas HH:MM; si el fin es menor que el inicio, cruza la medianoche. Null si falta o es inválida. */
export function tripMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  if (startMinutes === null || endMinutes === null) return null
  return endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes
}

/** "45 min", "1 h", "1 h 05 min"; vacío si no hay duración. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return ''
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  if (hours === 0) return `${remainder} min`
  return remainder === 0 ? `${hours} h` : `${hours} h ${String(remainder).padStart(2, '0')} min`
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

const blank = (value: unknown) => value === null || value === undefined || value === ''

/** Errores legibles por campo; objeto vacío = fila válida. Obligatorios: inicio, fin, distancia ≥ 0 y monto > 0. */
export function validateTrip(fields: TripFields): TripErrors {
  const errors: TripErrors = {}
  if (blank(fields.startTime)) errors.startTime = 'Falta la hora de recogida'
  else if (toMinutes(fields.startTime) === null) errors.startTime = 'Hora de recogida inválida'
  if (blank(fields.endTime)) errors.endTime = 'Falta la hora de llegada'
  else if (toMinutes(fields.endTime) === null) errors.endTime = 'Hora de llegada inválida'
  if (blank(fields.distanceKm) || typeof fields.distanceKm !== 'number' || !Number.isFinite(fields.distanceKm)) errors.distanceKm = 'Falta la distancia'
  else if (fields.distanceKm < 0) errors.distanceKm = 'La distancia no puede ser negativa'
  if (blank(fields.amount) || typeof fields.amount !== 'number' || !Number.isFinite(fields.amount)) errors.amount = 'Falta el monto'
  else if (fields.amount <= 0) errors.amount = 'El monto debe ser mayor que cero'
  if (!blank(fields.bonus)) {
    if (typeof fields.bonus !== 'number' || !Number.isFinite(fields.bonus)) errors.bonus = 'Bonus inválido'
    else if (fields.bonus < 0) errors.bonus = 'El bonus no puede ser negativo'
  }
  return errors
}

/** Total que deja el viaje: dinero + bonus (ausente cuenta 0). */
export const tripTotal = (trip: { amount: number; bonus?: number | null }): number =>
  trip.amount + (typeof trip.bonus === 'number' && Number.isFinite(trip.bonus) && trip.bonus > 0 ? trip.bonus : 0)

/** Suma de distancias de las filas que la tienen (ignora vacías y negativas). */
export function sumDistance(rows: { distanceKm?: number | null }[]): number {
  const total = rows.reduce((total, row) => (typeof row.distanceKm === 'number' && row.distanceKm > 0 ? total + row.distanceKm : total), 0)
  return Math.round(total * 1000) / 1000
}

/** Un servicio sin ningún dato de viaje (anterior a esta función) se muestra y guarda tal cual. */
export const hasTripData = (trip: Pick<TripFields, 'startTime' | 'endTime' | 'distanceKm' | 'origin' | 'destination'>) =>
  !blank(trip.startTime) || !blank(trip.endTime) || !blank(trip.distanceKm) || !blank(trip.origin) || !blank(trip.destination)
