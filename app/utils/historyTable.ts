/** Lógica pura de la tabla de Historial: un viaje por fila, búsqueda por día u horario, paginación y preferencias guardadas. */
import type { DayRecord, Service, ShiftTemplate } from '../services/types'
import { tripTotal } from './trip'

export interface HistoryRow {
  /** Clave única de la fila (id del viaje, o `fecha:vacio` para un día sin viajes). */
  key: string
  date: string
  /** Texto corto para mostrar («mié 5 nov»). */
  dayLabel: string
  tripId: string | null
  shift: string
  startTime: string
  endTime: string
  origin: string
  destination: string
  km: number | null
  amount: number
  bonus: number
  total: number
  method: string | undefined
  isIndrive: boolean
  /** Comisión inDrive + IVA del viaje. */
  commission: number
  /** Total del viaje menos comisión e IVA (antes de costos por km, que se calculan por día). */
  net: number
  /** Texto normalizado en el que busca el filtro. */
  searchText: string
}

export const NO_SHIFT_LABEL = 'Sin turno'

const shortFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const longFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
const parseDate = (iso: string) => new Date(`${iso}T12:00:00`)

/** Minúsculas y sin tildes, para comparar el texto del usuario con el de la tabla. */
const normalize = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function shiftLabelOf(day: DayRecord, trip: Service, templates: ShiftTemplate[]): string {
  const shift = trip.shiftId ? (day.shifts ?? []).find(candidate => candidate.id === trip.shiftId) : undefined
  if (!shift) return NO_SHIFT_LABEL
  const template = shift.templateId ? templates.find(candidate => candidate.id === shift.templateId) : undefined
  return template?.name ?? `${shift.startTime}–${shift.endTime ?? '…'}`
}

function buildRow(day: DayRecord, trip: Service | null, templates: ShiftTemplate[], index: number): HistoryRow {
  const total = trip ? tripTotal(trip) : 0
  const commission = trip ? (trip.commission ?? 0) + (trip.commissionVat ?? 0) : 0
  const shift = trip ? shiftLabelOf(day, trip, templates) : ''
  const startTime = trip?.startTime ?? ''
  const endTime = trip?.endTime ?? ''
  const [year, month, dayOfMonth] = day.date.split('-')
  const searchText = normalize([day.date, `${dayOfMonth}/${month}/${year}`, longFormatter.format(parseDate(day.date)), shift, startTime, endTime].join(' | '))
  const tripId = trip ? (trip.id ?? `${day.date}:${index}`) : null
  return {
    key: tripId ?? `${day.date}:vacio`,
    date: day.date,
    dayLabel: shortFormatter.format(parseDate(day.date)).replace(/\./g, ''),
    tripId,
    shift, startTime, endTime,
    origin: trip?.origin ?? '',
    destination: trip?.destination ?? '',
    km: trip?.distanceKm ?? null,
    amount: trip?.amount ?? 0,
    bonus: trip?.bonus ?? 0,
    total,
    method: trip?.method,
    isIndrive: trip ? trip.isIndrive !== false : false,
    commission,
    net: trip ? total - commission : 0,
    searchText,
  }
}

/** Una fila por viaje: días más nuevos primero y, dentro del día, por hora de recogida. Un día sin viajes deja una fila vacía (para poder eliminarlo). */
export function buildHistoryRows(days: DayRecord[], templates: ShiftTemplate[]): HistoryRow[] {
  return [...days].sort((first, second) => second.date.localeCompare(first.date)).flatMap((day) => {
    if (!day.services.length) return [buildRow(day, null, templates, 0)]
    return day.services
      .map((trip, index) => ({ trip, index }))
      .sort((first, second) => (first.trip.startTime ?? '99:99').localeCompare(second.trip.startTime ?? '99:99') || first.index - second.index)
      .map(({ trip, index }) => buildRow(day, trip, templates, index))
  })
}

const MERIDIEM = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/g

/** «2 pm» → «14:», «8:15 pm» → «20:15» (formato 24 h de la tabla); fuera de rango se deja tal cual. */
function expandMeridiem(query: string): string {
  return query.replace(MERIDIEM, (match, hourText: string, minutes: string | undefined, meridiem: string) => {
    const hour = Number(hourText)
    if (hour < 1 || hour > 12) return match
    const hour24 = (hour % 12) + (meridiem === 'p' ? 12 : 0)
    return `${String(hour24).padStart(2, '0')}:${minutes ?? ''}`
  })
}

const DAY_MONTH = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/

function tokenMatches(row: HistoryRow, token: string): boolean {
  const dayMonth = DAY_MONTH.exec(token)
  if (dayMonth) {
    const [year, month, dayOfMonth] = row.date.split('-')
    if (Number(dayMonth[1]) !== Number(dayOfMonth) || Number(dayMonth[2]) !== Number(month)) return false
    if (!dayMonth[3]) return true
    return (dayMonth[3].length === 2 ? `20${dayMonth[3]}` : dayMonth[3]) === year
  }
  return row.searchText.includes(token)
}

/** Filtra por día (fecha ISO, «05/11», «5/11/2026», nombre de día o mes) y por horario (recogida/llegada, «14:», «2 pm») o turno. Varios términos se combinan con Y. */
export function filterHistoryRows(rows: HistoryRow[], query: string): HistoryRow[] {
  const tokens = expandMeridiem(normalize(query)).split(/\s+/).filter(Boolean)
  if (!tokens.length) return rows
  return rows.filter(row => tokens.every(token => tokenMatches(row, token)))
}

export interface Page<Item> {
  items: Item[]
  page: number
  pageCount: number
  total: number
}

/** Página `page` (base 1, limitada al rango válido) de `pageSize` ítems; `pageSize` 0 = todos. */
export function paginateRows<Item>(items: Item[], page: number, pageSize: number): Page<Item> {
  const total = items.length
  if (pageSize <= 0) return { items, page: 1, pageCount: 1, total }
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount)
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount, total }
}

export type HistoryColumnKey =
  | 'date' | 'shift' | 'startTime' | 'endTime' | 'origin' | 'destination' | 'km' | 'amount' | 'bonus' | 'method' | 'commission' | 'total' | 'net'

export const HISTORY_COLUMNS: { key: HistoryColumnKey; label: string; numeric: boolean }[] = [
  { key: 'date', label: 'Fecha', numeric: false },
  { key: 'shift', label: 'Turno', numeric: false },
  { key: 'startTime', label: 'Recogida', numeric: false },
  { key: 'endTime', label: 'Llegada', numeric: false },
  { key: 'origin', label: 'Origen', numeric: false },
  { key: 'destination', label: 'Destino', numeric: false },
  { key: 'km', label: 'Km', numeric: true },
  { key: 'amount', label: 'Valor', numeric: true },
  { key: 'bonus', label: 'Bonus', numeric: true },
  { key: 'method', label: 'Método', numeric: false },
  { key: 'commission', label: 'inDrive (comisión + IVA)', numeric: true },
  { key: 'total', label: 'Total', numeric: true },
  { key: 'net', label: 'Neto', numeric: true },
]

export const DEFAULT_VISIBLE_COLUMNS: HistoryColumnKey[] = ['date', 'shift', 'startTime', 'endTime', 'origin', 'destination', 'km', 'total', 'net']
export const PAGE_SIZES = [12, 24, 48, 0] as const
export const DEFAULT_PAGE_SIZE = 12

export interface HistoryPreferences {
  pageSize: number
  columns: HistoryColumnKey[]
}

const STORAGE_KEY = 'taurus-history-prefs'
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>
const browserStorage = (): KeyValueStorage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage)

/** Preferencias guardadas; datos ausentes, corruptos o fuera de catálogo vuelven a los valores por defecto. */
export function loadHistoryPreferences(storage: KeyValueStorage | undefined = browserStorage()): HistoryPreferences {
  const defaults: HistoryPreferences = { pageSize: DEFAULT_PAGE_SIZE, columns: DEFAULT_VISIBLE_COLUMNS }
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<{ pageSize: number; columns: string[] }> | null
    if (!parsed) return defaults
    const pageSize = (PAGE_SIZES as readonly number[]).includes(parsed.pageSize as number) ? parsed.pageSize! : DEFAULT_PAGE_SIZE
    const wanted = new Set(Array.isArray(parsed.columns) ? parsed.columns : [])
    const columns = HISTORY_COLUMNS.map(column => column.key).filter(key => wanted.has(key))
    return { pageSize, columns: columns.length ? columns : DEFAULT_VISIBLE_COLUMNS }
  } catch {
    return defaults
  }
}

export function saveHistoryPreferences(preferences: HistoryPreferences, storage: KeyValueStorage | undefined = browserStorage()): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(preferences)) } catch { /* sin storage */ }
}
