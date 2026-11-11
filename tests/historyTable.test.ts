import { describe, expect, it } from 'vitest'
import type { DayRecord, Service, Shift, ShiftTemplate } from '../app/services/types'
import {
  DEFAULT_PAGE_SIZE, DEFAULT_VISIBLE_COLUMNS, HISTORY_COLUMNS, buildHistoryRows, filterHistoryRows, loadHistoryPreferences, paginateRows, saveHistoryPreferences,
} from '../app/utils/historyTable'

const MORNING: ShiftTemplate = { id: 't-am', name: 'Mañana', startTime: '06:00', endTime: '10:00', sortOrder: 0, active: true }
const shift = (id: string, date: string, startTime: string, endTime: string, templateId?: string): Shift => ({ id, date, startTime, endTime, ...(templateId ? { templateId } : {}) })
const trip = (id: string, startTime: string, endTime: string, extra: Partial<Service> = {}): Service => ({ id, amount: 10000, distanceKm: 5, startTime, endTime, ...extra })
const day = (date: string, services: Service[], shifts: Shift[] = []): DayRecord =>
  ({ date, km: 0, services, shifts, costs: [], gross: 0, totalCost: 0, commission: 0, commissionVat: 0, net: 0 })

// 2026-11-05 es jueves; 2026-11-09 es lunes.
const DAYS = [
  day('2026-11-05', [trip('a', '14:10', '14:50', { shiftId: 's1', bonus: 1000, commission: 900, commissionVat: 171 })], [shift('s1', '2026-11-05', '06:00', '10:00', 't-am')]),
  day('2026-11-09', [trip('b', '08:00', '08:30'), trip('c', '20:15', '21:00', { shiftId: 's2' })], [shift('s2', '2026-11-09', '19:00', '23:00')]),
  day('2026-11-10', []),
]
const rows = () => buildHistoryRows(DAYS, [MORNING])
const keysOf = (query: string) => filterHistoryRows(rows(), query).map(row => row.tripId ?? row.date)

describe('buildHistoryRows', () => {
  it('una fila por viaje, días más nuevos primero, con turno por plantilla, rango o sin turno', () => {
    const built = rows()
    expect(built.map(row => row.tripId)).toEqual([null, 'b', 'c', 'a'])
    expect(built.find(row => row.tripId === 'a')!.shift).toBe('Mañana')
    expect(built.find(row => row.tripId === 'c')!.shift).toBe('19:00–23:00')
    expect(built.find(row => row.tripId === 'b')!.shift).toBe('Sin turno')
  })
  it('calcula el total y el neto del viaje con bonus, comisión e IVA', () => {
    const row = rows().find(entry => entry.tripId === 'a')!
    expect(row.total).toBe(11000)
    expect(row.commission).toBe(1071)
    expect(row.net).toBe(11000 - 1071)
  })
  it('un día sin viajes conserva una fila vacía para poder eliminarlo', () => {
    expect(rows()[0]).toMatchObject({ date: '2026-11-10', tripId: null })
  })
})

describe('filterHistoryRows', () => {
  it('sin texto devuelve todo', () => expect(filterHistoryRows(rows(), '  ')).toHaveLength(4))
  it('busca por fecha ISO, por día/mes y por nombre de día o mes', () => {
    expect(keysOf('2026-11-05')).toEqual(['a'])
    expect(keysOf('05/11')).toEqual(['a'])
    expect(keysOf('5/11/2026')).toEqual(['a'])
    expect(keysOf('jueves')).toEqual(['a'])
    expect(keysOf('lunes')).toEqual(['b', 'c'])
    expect(keysOf('noviembre')).toHaveLength(4)
  })
  it('busca por hora de recogida o llegada, con prefijo de hora', () => {
    expect(keysOf('14:')).toEqual(['a'])
    expect(keysOf('08:30')).toEqual(['b'])
    expect(keysOf('21:00')).toEqual(['c'])
  })
  it('entiende horas con am/pm', () => {
    expect(keysOf('2 pm')).toEqual(['a'])
    expect(keysOf('2pm')).toEqual(['a'])
    expect(keysOf('8:15 pm')).toEqual(['c'])
    expect(keysOf('8 am')).toEqual(['b'])
  })
  it('busca por turno ignorando mayúsculas y tildes, y combina términos con Y', () => {
    expect(keysOf('manana')).toEqual(['a'])
    expect(keysOf('sin turno')).toEqual(['b'])
    expect(keysOf('lunes 20:')).toEqual(['c'])
    expect(keysOf('jueves 20:')).toEqual([])
  })
})

describe('paginateRows', () => {
  const items = Array.from({ length: 30 }, (_value, index) => index)
  it('corta por página y calcula el total de páginas', () => {
    expect(paginateRows(items, 1, 12)).toMatchObject({ page: 1, pageCount: 3, total: 30, items: items.slice(0, 12) })
    expect(paginateRows(items, 3, 12).items).toEqual(items.slice(24))
  })
  it('limita la página al rango válido y 0 significa todos', () => {
    expect(paginateRows(items, 99, 12).page).toBe(3)
    expect(paginateRows(items, -1, 12).page).toBe(1)
    expect(paginateRows(items, 5, 0)).toMatchObject({ page: 1, pageCount: 1, items })
    expect(paginateRows([], 1, 12)).toMatchObject({ page: 1, pageCount: 1, total: 0 })
  })
})

describe('preferencias de Historial', () => {
  const memory = () => {
    const data = new Map<string, string>()
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
  }
  it('usa 12 ítems y las columnas por defecto sin guardado', () => {
    expect(loadHistoryPreferences(memory())).toEqual({ pageSize: DEFAULT_PAGE_SIZE, columns: DEFAULT_VISIBLE_COLUMNS })
    expect(DEFAULT_PAGE_SIZE).toBe(12)
  })
  it('guarda y recupera la elección, en el orden de la tabla', () => {
    const storage = memory()
    saveHistoryPreferences({ pageSize: 24, columns: ['net', 'date'] }, storage)
    expect(loadHistoryPreferences(storage)).toEqual({ pageSize: 24, columns: ['date', 'net'] })
  })
  it('ignora datos corruptos, columnas desconocidas y tamaños inválidos', () => {
    const storage = memory()
    storage.setItem('taurus-history-prefs', '{"pageSize":7,"columns":["zzz"]}')
    expect(loadHistoryPreferences(storage)).toEqual({ pageSize: 12, columns: DEFAULT_VISIBLE_COLUMNS })
    storage.setItem('taurus-history-prefs', 'no-json')
    expect(loadHistoryPreferences(storage).pageSize).toBe(12)
  })
  it('todas las columnas por defecto existen', () => {
    const known = HISTORY_COLUMNS.map(column => column.key)
    expect(DEFAULT_VISIBLE_COLUMNS.every(key => known.includes(key))).toBe(true)
  })
})
