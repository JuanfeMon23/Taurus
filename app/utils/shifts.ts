/** Lógica pura de turnos para la vista Hoy (sin E/S). */
import type { DayRecord, NewShift, Service, Shift, ShiftTemplate } from '../services/types'
import { tripMinutes } from './trip'

/** Hora local como HH:MM. */
export function clockNow(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Fecha ISO del día anterior a `date` (YYYY-MM-DD). */
export function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00`)
  day.setDate(day.getDate() - 1)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** Turno en curso (sin fin), si hay. */
export const findOpenShift = (shifts: Shift[]): Shift | undefined => shifts.find(shift => !shift.endTime)

/** Minutos totales de turno; el en curso cuenta hasta `now` (HH:MM) solo si se entrega. */
export function totalShiftMinutes(shifts: Shift[], now?: string): number {
  return shifts.reduce((total, shift) => total + (tripMinutes(shift.startTime, shift.endTime || now) ?? 0), 0)
}

/** Copias, para `date`, de los turnos con fin del día anterior (los en curso no se copian). */
export function copyClosedShifts(source: Shift[], date: string): NewShift[] {
  return source.filter(shift => shift.endTime).map(shift => ({
    date, startTime: shift.startTime, endTime: shift.endTime, ...(shift.note ? { note: shift.note } : {}), ...(shift.templateId ? { templateId: shift.templateId } : {}),
  }))
}

/** Plantillas en el orden en que se muestran: `sortOrder` y luego hora de inicio. Devuelve una copia. */
export const sortShiftTemplates = (templates: ShiftTemplate[]): ShiftTemplate[] =>
  [...templates].sort((first, second) => first.sortOrder - second.sortOrder || first.startTime.localeCompare(second.startTime))

/** Solo las plantillas activas, ordenadas. */
export const activeShiftTemplates = (templates: ShiftTemplate[]): ShiftTemplate[] => sortShiftTemplates(templates.filter(template => template.active))

/** Turno del día creado con una plantilla (la marca queda en `templateId`, así sobrevive a ajustes de hora). */
export const buildShiftFromTemplate = (template: ShiftTemplate, date: string): NewShift => ({
  date, startTime: template.startTime, endTime: template.endTime, templateId: template.id,
})

/** Turno del día que viene de la plantilla, si está aplicada. */
export const shiftForTemplate = (shifts: Shift[], templateId: string): Shift | undefined => shifts.find(shift => shift.templateId === templateId)

/** Ids de las plantillas ya aplicadas en el día (los turnos sueltos no cuentan). */
export const appliedTemplateIds = (shifts: Shift[]): Set<string> =>
  new Set(shifts.map(shift => shift.templateId).filter((templateId): templateId is string => !!templateId))

/** Hora de referencia para turnos en curso: solo cuenta en el día de hoy (en otros días un turno sin fin se ignora). */
export const activityNow = (date: string, today: string, now: string = clockNow()): string | undefined => (date === today ? now : undefined)

/** Agrega días vacíos (sin viajes ni montos) para las fechas que solo tienen turnos; los turnos de los días existentes se conservan. */
export function withShiftOnlyDays(days: DayRecord[], shifts: Shift[]): DayRecord[] {
  const known = new Set(days.map(day => day.date))
  const extraByDate = new Map<string, Shift[]>()
  for (const shift of shifts) if (!known.has(shift.date)) extraByDate.set(shift.date, [...(extraByDate.get(shift.date) ?? []), shift])
  const emptyDays = [...extraByDate].map(([date, dayShifts]): DayRecord => ({
    date, km: 0, services: [], shifts: dayShifts, costs: [], gross: 0, totalCost: 0, commission: 0, commissionVat: 0, net: 0,
  }))
  return [...days, ...emptyDays]
}

/**
 * Turno por defecto de un viaje nuevo (nunca vacío si el día tiene turnos). Orden de reglas:
 * 1) el turno de la última plantilla usada, si está marcada en el día;
 * 2) el único turno del día;
 * 3) el turno que contiene la hora de recogida, si ya está escrita (los turnos que cruzan la medianoche cuentan);
 * 4) el último turno del día por hora de inicio.
 * Vacío solo si el día no tiene turnos.
 */
export function defaultTripShiftId(shifts: Shift[], lastTemplateId?: string, pickupTime?: string): string {
  const remembered = lastTemplateId ? shiftForTemplate(shifts, lastTemplateId) : undefined
  if (remembered) return remembered.id
  if (shifts.length <= 1) return shifts[0]?.id ?? ''
  const containing = pickupTime
    ? shifts.find(shift => {
        const offset = tripMinutes(shift.startTime, pickupTime)
        const length = tripMinutes(shift.startTime, shift.endTime)
        return offset !== null && length !== null && offset <= length
      })
    : undefined
  if (containing) return containing.id
  return [...shifts].sort((first, second) => first.startTime.localeCompare(second.startTime)).at(-1)!.id
}

/** Viajes ligados a un turno del día. */
export const tripsOfShift = <T extends Pick<Service, 'shiftId'>>(trips: T[], shiftId: string): T[] => trips.filter(trip => trip.shiftId === shiftId)

/** Aviso que bloquea quitar un turno con viajes ligados; vacío si se puede quitar. */
export function shiftRemovalBlock(trips: Pick<Service, 'shiftId'>[], shiftId: string): string {
  const count = tripsOfShift(trips, shiftId).length
  if (!count) return ''
  return count === 1
    ? 'Este turno tiene 1 viaje; cámbialo a otro turno antes de quitarlo'
    : `Este turno tiene ${count} viajes; cámbialos a otro turno antes de quitarlo`
}

/** Franja HH:MM–HH:MM para mostrar junto al nombre del turno; vacía si el nombre ya trae una hora (p. ej. «4:30 a 7:00 am»). */
export const chipRangeLabel = (name: string, range: string): string => (/\d{1,2}:\d{2}/.test(name) ? '' : range)

/** Preferencia de interfaz: última plantilla de turno elegida para un viaje (localStorage, tolera storage no disponible). */
const LAST_SHIFT_TEMPLATE_KEY = 'taurus.lastShiftTemplate'
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>
const browserStorage = (): KeyValueStorage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)

export function loadLastShiftTemplateId(storage: KeyValueStorage | undefined = browserStorage()): string | undefined {
  try { return storage?.getItem(LAST_SHIFT_TEMPLATE_KEY) || undefined } catch { return undefined }
}

export function saveLastShiftTemplateId(templateId: string, storage: KeyValueStorage | undefined = browserStorage()): void {
  try { storage?.setItem(LAST_SHIFT_TEMPLATE_KEY, templateId) } catch { /* sin storage */ }
}
