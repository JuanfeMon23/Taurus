import { describe, it, expect } from 'vitest'
import { ALL_WEEKDAYS_KEY, buildShiftWeekdayGrid, cellOpacity, DIMMED_OPACITY, filterByWeekday, highlightOpacity, isShiftHighlighted, isWeekdayHighlighted, weekdayFilterOptions, weekdayOf } from '../app/utils/shiftWeekday'
import { ALL_SHIFTS_KEY, buildShiftBreakdown } from '../app/utils/shiftStats'
import { dayNet } from '../app/utils/commission'
import type { DayRecord, Service, Shift, ShiftTemplate } from '../app/services/types'

const MORNING: ShiftTemplate = { id: 't-am', name: '4:00 a 7:30 am', startTime: '04:00', endTime: '07:30', sortOrder: 0, active: true }
const TEMPLATES = [MORNING]

const trip = (id: string, amount: number, shiftId: string | undefined, startTime: string, endTime: string): Service =>
  ({ id, amount, distanceKm: 0, startTime, endTime, ...(shiftId ? { shiftId } : {}) })
const shift = (id: string, date: string, templateId?: string): Shift => ({ id, date, startTime: '04:00', endTime: '07:30', ...(templateId ? { templateId } : {}) })
function day(date: string, services: Service[], shifts: Shift[]): DayRecord {
  const gross = services.reduce((total, service) => total + service.amount, 0)
  return { date, km: 0, services, shifts, costs: [], gross, totalCost: 0, commission: 0, commissionVat: 0, net: dayNet(gross, 0, 0, 0) }
}

// 2026-11-09 es lunes, 2026-11-13 es viernes, 2026-11-15 es domingo.
const monday = day('2026-11-09', [trip('a', 30000, 's1', '04:30', '05:30')], [shift('s1', '2026-11-09', 't-am')])
const friday = day('2026-11-13', [trip('b', 70000, 's2', '04:30', '06:00')], [shift('s2', '2026-11-13', 't-am')])
const historic = day('2026-11-04', [trip('h', 5000, undefined, '08:00', '08:30')], [])

describe('weekdayOf', () => {
  it('numera lunes=1 … domingo=7', () => {
    expect(weekdayOf('2026-11-09')).toBe(1)
    expect(weekdayOf('2026-11-10')).toBe(2)
    expect(weekdayOf('2026-11-13')).toBe(5)
    expect(weekdayOf('2026-11-14')).toBe(6)
    expect(weekdayOf('2026-11-15')).toBe(7)
  })
  it('no depende de la zona horaria en cambios de año y bisiestos', () => {
    expect(weekdayOf('2026-01-01')).toBe(4)
    expect(weekdayOf('2024-02-29')).toBe(4)
    expect(weekdayOf('2025-12-31')).toBe(3)
  })
})

describe('filtro por día de la semana', () => {
  it('ofrece Todos y lunes a domingo', () => {
    const options = weekdayFilterOptions()
    expect(options).toHaveLength(8)
    expect(options[0]).toEqual({ key: ALL_WEEKDAYS_KEY, name: 'Todos los días' })
    expect(options[1]).toEqual({ key: '1', name: 'Lunes' })
    expect(options[7]).toEqual({ key: '7', name: 'Domingo' })
  })
  it('deja solo los elementos de ese día y "all" no filtra', () => {
    const items = [monday, friday, historic]
    expect(filterByWeekday(items, '1')).toEqual([monday])
    expect(filterByWeekday(items, '5')).toEqual([friday])
    expect(filterByWeekday(items, '7')).toEqual([])
    expect(filterByWeekday(items, ALL_WEEKDAYS_KEY)).toBe(items)
  })
})

describe('buildShiftWeekdayGrid', () => {
  const grid = buildShiftWeekdayGrid([monday, friday, historic], TEMPLATES)

  it('una fila por plantilla y siete columnas; los viajes sin turno no entran', () => {
    expect(grid).toHaveLength(1)
    expect(grid[0]!.name).toBe('4:00 a 7:30 am')
    expect(grid[0]!.cells).toHaveLength(7)
  })
  it('separa el mismo turno por día de la semana con las métricas del desglose', () => {
    const [row] = grid
    const mondayCell = row!.cells[0]!
    expect(mondayCell.trips).toBe(1)
    expect(mondayCell.net).toBe(30000)
    expect(mondayCell.shiftMinutes).toBe(210)
    expect(mondayCell.netPerShiftHour).toBeCloseTo(30000 / 3.5)
    expect(row!.cells[4]!.netPerShiftHour).toBeCloseTo(70000 / 3.5)
    const reference = buildShiftBreakdown([friday], TEMPLATES).find(item => item.key === 't-am')!
    expect(row!.cells[4]!.net).toBe(reference.net)
  })
  it('los días sin datos quedan null, no 0', () => {
    const [row] = grid
    expect([1, 2, 3, 5, 6].map(index => row!.cells[index])).toEqual([null, null, null, null, null])
  })
  it('sin días devuelve vacío', () => {
    expect(buildShiftWeekdayGrid([], TEMPLATES)).toEqual([])
  })
})

describe('resaltado por filtros', () => {
  it('sin filtro todo está resaltado', () => {
    expect(isShiftHighlighted('t-am', ALL_SHIFTS_KEY)).toBe(true)
    expect(isWeekdayHighlighted(3, ALL_WEEKDAYS_KEY)).toBe(true)
  })
  it('con turno elegido solo ese turno está resaltado', () => {
    expect(isShiftHighlighted('t-am', 't-am')).toBe(true)
    expect(isShiftHighlighted('t-pm', 't-am')).toBe(false)
  })
  it('con día elegido solo su columna (índice 0 = lunes) está resaltada', () => {
    expect(isWeekdayHighlighted(4, '5')).toBe(true)
    expect(isWeekdayHighlighted(0, '5')).toBe(false)
  })
  it('atenúa lo no resaltado con opacidad baja', () => {
    expect(highlightOpacity(true)).toBe(1)
    expect(highlightOpacity(false)).toBe(DIMMED_OPACITY)
    expect(DIMMED_OPACITY).toBeGreaterThan(0)
    expect(DIMMED_OPACITY).toBeLessThan(1)
  })
  it('una celda solo es plena si coinciden turno y día', () => {
    expect(cellOpacity('t-am', 4, 't-am', '5')).toBe(1)
    expect(cellOpacity('t-am', 3, 't-am', '5')).toBe(DIMMED_OPACITY)
    expect(cellOpacity('t-pm', 4, 't-am', '5')).toBe(DIMMED_OPACITY)
    expect(cellOpacity('t-pm', 3, 't-am', '5')).toBe(DIMMED_OPACITY)
    expect(cellOpacity('t-pm', 3, ALL_SHIFTS_KEY, ALL_WEEKDAYS_KEY)).toBe(1)
    expect(cellOpacity('t-pm', 4, ALL_SHIFTS_KEY, '5')).toBe(1)
  })
})
