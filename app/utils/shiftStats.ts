/** Estadísticas por turno (puro, sin E/S): desglose por plantilla, filtro por turno y orden de turnos. */
import type { DayRecord, Service, Shift, ShiftTemplate } from '../services/types'
import { dayActivity, periodActivity } from './activity'
import { dayNet, sumCommission } from './commission'
import { sortShiftTemplates } from './shifts'
import { summarize } from './stats'
import { sumDistance, tripTotal } from './trip'

export const ALL_SHIFTS_KEY = 'all'
/** Viajes de turnos que no vienen de una plantilla vigente (sueltos o de plantillas borradas). */
export const LOOSE_SHIFT_KEY = '__loose'
/** Viajes sin turno (históricos anteriores a que el turno fuera obligatorio). */
export const NO_SHIFT_KEY = '__none'

const ALL_LABEL = 'Todos los turnos'
const LOOSE_LABEL = 'Turno suelto'
const NO_SHIFT_LABEL = 'Sin turno (histórico)'

export interface ShiftBreakdownRow {
  key: string
  name: string
  trips: number
  gross: number
  net: number
  km: number
  /** Horas de turno en minutos; 0 en «Sin turno». */
  shiftMinutes: number
  activeInShiftMinutes: number
  /** Neto / horas de turno; null sin horas de turno. */
  netPerShiftHour: number | null
  /** Activo en turno / turno; null sin horas de turno. */
  utilization: number | null
}

const shiftGroupKey = (shift: Pick<Shift, 'templateId'>, templates: ShiftTemplate[]): string =>
  shift.templateId && templates.some(template => template.id === shift.templateId) ? shift.templateId : LOOSE_SHIFT_KEY

/** Grupo de un viaje: plantilla de su turno, turno suelto, o sin turno si no tiene (o su turno ya no existe). */
export function tripShiftKey(day: Pick<DayRecord, 'shifts'>, trip: Pick<Service, 'shiftId'>, templates: ShiftTemplate[]): string {
  const shift = trip.shiftId ? (day.shifts ?? []).find(candidate => candidate.id === trip.shiftId) : undefined
  return shift ? shiftGroupKey(shift, templates) : NO_SHIFT_KEY
}

/**
 * Deja de cada día solo lo del grupo `key` (plantilla, suelto o sin turno); 'all' devuelve los días tal cual.
 * Regla de prorrateo bajo filtro: todo lo que es por viaje se calcula con los viajes del grupo (bruto con bonus,
 * comisión e IVA guardados en el viaje, km = suma de distancias); los costos por km se recalculan con las tarifas
 * guardadas en el día (snapshot) sobre esos km, y el neto sale de `dayNet`. Lo que no es por viaje (km extra del día)
 * no se reparte y queda fuera, igual que los gastos varios de caja (que el llamador no pasa bajo filtro).
 * Se conservan los días donde el turno existe aunque no tenga viajes (sus horas cuentan, con montos 0).
 */
export function filterDaysByShift(days: DayRecord[], templates: ShiftTemplate[], key: string): DayRecord[] {
  if (key === ALL_SHIFTS_KEY) return days
  const result: DayRecord[] = []
  for (const day of days) {
    const services = day.services.filter(service => tripShiftKey(day, service, templates) === key)
    const shifts = (day.shifts ?? []).filter(shift => shiftGroupKey(shift, templates) === key)
    if (!services.length && !shifts.length) continue
    const km = sumDistance(services)
    const costs = day.costs.map(cost => ({ ...cost, amount: km * cost.rate }))
    const totalCost = costs.reduce((total, cost) => total + cost.amount, 0)
    const gross = services.reduce((total, service) => total + tripTotal(service), 0)
    const { commission, commissionVat } = sumCommission(services)
    result.push({ ...day, services, shifts, km, costs, gross, totalCost, commission, commissionVat, net: dayNet(gross, totalCost, commission, commissionVat) })
  }
  return result
}

const groupName = (key: string, templates: ShiftTemplate[]): string =>
  key === LOOSE_SHIFT_KEY ? LOOSE_LABEL : key === NO_SHIFT_KEY ? NO_SHIFT_LABEL : templates.find(template => template.id === key)?.name ?? key

/** Claves de grupo con datos (viajes o turnos) en los días: plantillas en su orden, luego suelto y sin turno. */
function groupKeysWithData(days: DayRecord[], templates: ShiftTemplate[]): string[] {
  const present = new Set<string>()
  for (const day of days) {
    for (const service of day.services) present.add(tripShiftKey(day, service, templates))
    for (const shift of day.shifts ?? []) present.add(shiftGroupKey(shift, templates))
  }
  return [...sortShiftTemplates(templates).map(template => template.id), LOOSE_SHIFT_KEY, NO_SHIFT_KEY].filter(key => present.has(key))
}

/** Opciones del filtro de turno: Todos y cada grupo con datos en los días dados. */
export const shiftFilterOptions = (days: DayRecord[], templates: ShiftTemplate[]): { key: string; name: string }[] => [
  { key: ALL_SHIFTS_KEY, name: ALL_LABEL },
  ...groupKeysWithData(days, templates).map(key => ({ key, name: groupName(key, templates) })),
]

/**
 * Desglose por grupo de turno en el periodo: viajes, bruto, neto, km, horas de turno, neto por hora de turno y
 * aprovechamiento. Reutiliza `filterDaysByShift`, `summarize` y `dayActivity`/`periodActivity`; `now` (HH:MM) cierra
 * un turno en curso del día de hoy. «Sin turno» no tiene horas, así que no calcula neto por hora ni aprovechamiento.
 */
export function buildShiftBreakdown(days: DayRecord[], templates: ShiftTemplate[], now?: string): ShiftBreakdownRow[] {
  return groupKeysWithData(days, templates).map(key => {
    const groupDays = filterDaysByShift(days, templates, key)
    const totals = summarize(groupDays)
    const activity = periodActivity(groupDays.map(day => dayActivity(day.services, day.shifts ?? [], now)))
    const hasHours = key !== NO_SHIFT_KEY && activity.shiftMinutes > 0
    return {
      key,
      name: groupName(key, templates),
      trips: groupDays.reduce((total, day) => total + day.services.length, 0),
      gross: totals.gross,
      net: totals.net,
      km: totals.km,
      shiftMinutes: key === NO_SHIFT_KEY ? 0 : activity.shiftMinutes,
      activeInShiftMinutes: key === NO_SHIFT_KEY ? 0 : activity.activeInShiftMinutes,
      netPerShiftHour: hasHours ? totals.net / (activity.shiftMinutes / 60) : null,
      utilization: hasHours ? activity.utilization : null,
    }
  })
}

/** Un turno en curso solo cuenta en el día de hoy; en días pasados se ignora. */
export const dropStaleOpenShifts = (days: DayRecord[], today: string): DayRecord[] =>
  days.map(day => ({ ...day, shifts: day.date === today ? day.shifts : (day.shifts ?? []).filter(shift => shift.endTime) }))

/** Turnos del día en el orden de la barra de turnos: los de plantillas activas por su orden, luego el resto por hora de inicio. Devuelve una copia. */
export function sortShiftsForDisplay(shifts: Shift[], templates: ShiftTemplate[]): Shift[] {
  const order = sortShiftTemplates(templates.filter(template => template.active)).map(template => template.id)
  const rank = (shift: Shift) => (shift.templateId && order.includes(shift.templateId) ? order.indexOf(shift.templateId) : order.length)
  return [...shifts].sort((first, second) => rank(first) - rank(second) || first.startTime.localeCompare(second.startTime))
}
