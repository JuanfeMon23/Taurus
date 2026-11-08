/** Lógica pura de turnos para la vista Hoy (sin E/S). */
import type { DayRecord, NewShift, Shift, ShiftTemplate } from '../services/types'
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
