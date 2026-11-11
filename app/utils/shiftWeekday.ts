/** Turno × día de la semana (puro, sin E/S): el día de la semana se deriva de la fecha del día, nunca se elige a mano. */
import type { DayRecord, ShiftTemplate } from '../services/types'
import { ALL_SHIFTS_KEY, buildShiftBreakdown, NO_SHIFT_KEY } from './shiftStats'

export const ALL_WEEKDAYS_KEY = 'all'
/** Lunes = 1 … domingo = 7 (ISO 8601). */
export const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const
export const WEEKDAY_SHORT_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Día de la semana ISO (lunes=1 … domingo=7) de una fecha local `AAAA-MM-DD`; se calcula en UTC para que la zona horaria no la mueva. */
export function weekdayOf(date: string): number {
  const [year = 0, month = 1, dayOfMonth = 1] = date.split('-').map(Number)
  const jsDay = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

/** Opciones del filtro «Día de la semana»: Todos y lunes a domingo. */
export const weekdayFilterOptions = (): { key: string; name: string }[] => [
  { key: ALL_WEEKDAYS_KEY, name: 'Todos los días' },
  ...WEEKDAY_NAMES.map((name, index) => ({ key: String(index + 1), name })),
]

/** Deja solo los elementos con fecha cuyo día de la semana es `key` (1-7); 'all' los devuelve tal cual. */
export function filterByWeekday<Item extends { date: string }>(items: Item[], key: string): Item[] {
  return key === ALL_WEEKDAYS_KEY ? items : items.filter(item => String(weekdayOf(item.date)) === key)
}

export interface ShiftWeekdayCell {
  trips: number
  net: number
  shiftMinutes: number
  /** Neto / horas de turno; null sin horas de turno (la celda se dibuja vacía). */
  netPerShiftHour: number | null
}

export interface ShiftWeekdayRow {
  key: string
  name: string
  /** Siete celdas, lunes a domingo; null = sin datos ese día de la semana. */
  cells: (ShiftWeekdayCell | null)[]
}

/**
 * Mapa plantilla × día de la semana: reutiliza `buildShiftBreakdown` (misma regla de prorrateo) sobre los días de cada
 * día de la semana. Los viajes sin turno (históricos) no entran; los turnos sueltos sí, en su fila.
 */
export function buildShiftWeekdayGrid(days: DayRecord[], templates: ShiftTemplate[], now?: string): ShiftWeekdayRow[] {
  const perWeekday = WEEKDAY_NAMES.map((_, index) => buildShiftBreakdown(filterByWeekday(days, String(index + 1)), templates, now))
  return buildShiftBreakdown(days, templates, now)
    .filter(row => row.key !== NO_SHIFT_KEY)
    .map(row => ({
      key: row.key,
      name: row.name,
      cells: perWeekday.map(rows => {
        const cell = rows.find(candidate => candidate.key === row.key)
        return cell ? { trips: cell.trips, net: cell.net, shiftMinutes: cell.shiftMinutes, netPerShiftHour: cell.netPerShiftHour } : null
      }),
    }))
}

/** Opacidad de lo que no coincide con los filtros activos en los bloques comparativos (siguen mostrando todo, atenuado). */
export const DIMMED_OPACITY = 0.3

/** ¿La fila/barra de este turno se resalta? Sí sin filtro de turno o si es el turno elegido. */
export const isShiftHighlighted = (shiftKey: string, shiftFilterKey: string): boolean => shiftFilterKey === ALL_SHIFTS_KEY || shiftKey === shiftFilterKey

/** ¿La columna de este día (0 = lunes … 6 = domingo) se resalta? Sí sin filtro de día o si es el día elegido. */
export const isWeekdayHighlighted = (columnIndex: number, weekdayFilterKey: string): boolean => weekdayFilterKey === ALL_WEEKDAYS_KEY || String(columnIndex + 1) === weekdayFilterKey

export const highlightOpacity = (highlighted: boolean): number => (highlighted ? 1 : DIMMED_OPACITY)

/** Opacidad de una celda turno × día: plena solo si coinciden ambos filtros activos. */
export const cellOpacity = (shiftKey: string, columnIndex: number, shiftFilterKey: string, weekdayFilterKey: string): number =>
  highlightOpacity(isShiftHighlighted(shiftKey, shiftFilterKey) && isWeekdayHighlighted(columnIndex, weekdayFilterKey))
