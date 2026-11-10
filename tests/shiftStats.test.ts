import { describe, it, expect } from 'vitest'
import { ALL_SHIFTS_KEY, LOOSE_SHIFT_KEY, NO_SHIFT_KEY, buildShiftBreakdown, dropStaleOpenShifts, filterDaysByShift, shiftFilterOptions, sortShiftsForDisplay, tripShiftKey } from '../app/utils/shiftStats'
import { dayNet } from '../app/utils/commission'
import type { DayRecord, Service, Shift, ShiftTemplate } from '../app/services/types'

const template = (id: string, name: string, startTime: string, endTime: string, sortOrder: number): ShiftTemplate => ({ id, name, startTime, endTime, sortOrder, active: true })
const MORNING = template('t-am', '6:00 a 10:00 am', '06:00', '10:00', 0)
const NIGHT = template('t-pm', '6:00 a 10:00 pm', '18:00', '22:00', 1)
const TEMPLATES = [NIGHT, MORNING]

const shift = (id: string, startTime: string, endTime: string | undefined, templateId?: string): Shift => ({ id, date: '2026-11-09', startTime, ...(endTime ? { endTime } : {}), ...(templateId ? { templateId } : {}) })
const trip = (id: string, amount: number, distanceKm: number, shiftId: string | undefined, startTime: string, endTime: string, extra: Partial<Service> = {}): Service =>
  ({ id, amount, distanceKm, startTime, endTime, ...(shiftId ? { shiftId } : {}), ...extra })

/** Día con costos por km de 100 + 50 (150 por km) y km extra opcional. */
function day(date: string, services: Service[], shifts: Shift[], extraKm = 0): DayRecord {
  const km = services.reduce((total, service) => total + (service.distanceKm ?? 0), 0) + extraKm
  const costs = [{ categoryId: 'fuel', name: 'Combustible', rate: 100, amount: km * 100 }, { categoryId: 'maint', name: 'Mantenimiento', rate: 50, amount: km * 50 }]
  const gross = services.reduce((total, service) => total + service.amount + (service.bonus ?? 0), 0)
  const totalCost = km * 150
  const commission = services.reduce((total, service) => total + (service.commission ?? 0), 0)
  const commissionVat = services.reduce((total, service) => total + (service.commissionVat ?? 0), 0)
  return { date, km, services, shifts: shifts.map(item => ({ ...item, date })), costs, gross, totalCost, commission, commissionVat, net: dayNet(gross, totalCost, commission, commissionVat) }
}

const morning = shift('s-am', '06:00', '10:00', 't-am')
const night = shift('s-pm', '18:00', '22:00', 't-pm')
const loose = shift('s-x', '12:00', '13:00')

const sample = (): DayRecord[] => [
  // Histórico: sin turno.
  day('2026-11-01', [trip('h1', 20000, 10, undefined, '08:00', '08:30')], []),
  day('2026-11-09', [
    trip('a', 10000, 5, 's-am', '06:00', '07:00', { bonus: 1000, commission: 950, commissionVat: 180.5 }),
    trip('b', 6000, 3, 's-am', '08:00', '09:00'),
    trip('c', 30000, 10, 's-pm', '18:00', '20:00'),
    trip('d', 4000, 2, 's-x', '12:00', '12:30'),
  ], [morning, night, loose], 4),
]

describe('tripShiftKey', () => {
  const [historic, nov9] = sample() as [DayRecord, DayRecord]
  it('usa la plantilla del turno del viaje', () => {
    expect(tripShiftKey(nov9, nov9.services[0]!, TEMPLATES)).toBe('t-am')
    expect(tripShiftKey(nov9, nov9.services[2]!, TEMPLATES)).toBe('t-pm')
  })
  it('turno sin plantilla (o con plantilla desconocida) es suelto', () => {
    expect(tripShiftKey(nov9, nov9.services[3]!, TEMPLATES)).toBe(LOOSE_SHIFT_KEY)
    expect(tripShiftKey(nov9, nov9.services[0]!, [])).toBe(LOOSE_SHIFT_KEY)
  })
  it('viaje sin turno o con turno inexistente va a sin turno', () => {
    expect(tripShiftKey(historic, historic.services[0]!, TEMPLATES)).toBe(NO_SHIFT_KEY)
    expect(tripShiftKey(nov9, { id: 'z', amount: 1, shiftId: 'borrado' }, TEMPLATES)).toBe(NO_SHIFT_KEY)
  })
})

describe('filterDaysByShift', () => {
  it('Todos devuelve los días tal cual', () => {
    const days = sample()
    expect(filterDaysByShift(days, TEMPLATES, ALL_SHIFTS_KEY)).toBe(days)
  })
  it('deja solo los viajes y turnos de la plantilla y quita los días sin ellos', () => {
    const filtered = filterDaysByShift(sample(), TEMPLATES, 't-am')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.date).toBe('2026-11-09')
    expect(filtered[0]!.services.map(service => service.id)).toEqual(['a', 'b'])
    expect(filtered[0]!.shifts!.map(item => item.id)).toEqual(['s-am'])
  })
  it('recalcula bruto, comisión, km y costos solo con los viajes del turno (km extra no se reparte)', () => {
    const [filtered] = filterDaysByShift(sample(), TEMPLATES, 't-am')
    expect(filtered!.gross).toBe(17000)
    expect(filtered!.km).toBe(8)
    expect(filtered!.totalCost).toBe(8 * 150)
    expect(filtered!.costs.map(cost => cost.amount)).toEqual([800, 400])
    expect(filtered!.commission).toBe(950)
    expect(filtered!.commissionVat).toBe(180.5)
    expect(filtered!.net).toBe(dayNet(17000, 1200, 950, 180.5))
  })
  it('sin turno agrupa los viajes históricos y no trae turnos', () => {
    const filtered = filterDaysByShift(sample(), TEMPLATES, NO_SHIFT_KEY)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.date).toBe('2026-11-01')
    expect(filtered[0]!.shifts).toEqual([])
  })
  it('un turno suelto cuenta como grupo propio', () => {
    const [filtered] = filterDaysByShift(sample(), TEMPLATES, LOOSE_SHIFT_KEY)
    expect(filtered!.services.map(service => service.id)).toEqual(['d'])
    expect(filtered!.km).toBe(2)
  })
  it('conserva un día donde el turno existe pero no tiene viajes (sus horas cuentan, montos 0)', () => {
    const days = [day('2026-11-09', [trip('c', 30000, 10, 's-pm', '18:00', '20:00')], [morning, night])]
    const [filtered] = filterDaysByShift(days, TEMPLATES, 't-am')
    expect(filtered!.services).toEqual([])
    expect(filtered!.gross).toBe(0)
    expect(filtered!.net).toBe(0)
    expect(filtered!.shifts).toHaveLength(1)
  })
})

describe('buildShiftBreakdown', () => {
  const rows = buildShiftBreakdown(sample(), TEMPLATES)
  it('ordena plantillas por sortOrder, luego suelto y sin turno', () => {
    expect(rows.map(row => row.key)).toEqual(['t-am', 't-pm', LOOSE_SHIFT_KEY, NO_SHIFT_KEY])
    expect(rows.map(row => row.name)).toEqual(['6:00 a 10:00 am', '6:00 a 10:00 pm', 'Turno suelto', 'Sin turno (histórico)'])
  })
  it('suma viajes, bruto, neto y km del turno', () => {
    const morningRow = rows[0]!
    expect(morningRow.trips).toBe(2)
    expect(morningRow.gross).toBe(17000)
    expect(morningRow.km).toBe(8)
    expect(morningRow.net).toBe(dayNet(17000, 1200, 950, 180.5))
  })
  it('neto por hora de turno y aprovechamiento usan las horas del turno', () => {
    const morningRow = rows[0]!
    expect(morningRow.shiftMinutes).toBe(240)
    expect(morningRow.netPerShiftHour).toBeCloseTo(morningRow.net / 4, 6)
    expect(morningRow.utilization).toBeCloseTo(120 / 240, 6)
    expect(rows[1]!.utilization).toBeCloseTo(120 / 240, 6)
  })
  it('sin turno no tiene horas, neto por hora ni aprovechamiento', () => {
    const none = rows.at(-1)!
    expect(none.trips).toBe(1)
    expect(none.shiftMinutes).toBe(0)
    expect(none.netPerShiftHour).toBeNull()
    expect(none.utilization).toBeNull()
  })
  it('omite los grupos sin viajes ni turnos', () => {
    expect(buildShiftBreakdown([sample()[1]!], TEMPLATES).map(row => row.key)).toEqual(['t-am', 't-pm', LOOSE_SHIFT_KEY])
  })
})

describe('shiftFilterOptions', () => {
  it('ofrece Todos y solo los grupos con datos', () => {
    expect(shiftFilterOptions(sample(), TEMPLATES).map(option => option.key)).toEqual([ALL_SHIFTS_KEY, 't-am', 't-pm', LOOSE_SHIFT_KEY, NO_SHIFT_KEY])
    expect(shiftFilterOptions([sample()[0]!], TEMPLATES).map(option => option.key)).toEqual([ALL_SHIFTS_KEY, NO_SHIFT_KEY])
  })
  it('sin datos solo queda Todos', () => {
    expect(shiftFilterOptions([], TEMPLATES)).toEqual([{ key: ALL_SHIFTS_KEY, name: 'Todos los turnos' }])
  })
})

describe('dropStaleOpenShifts', () => {
  it('quita los turnos en curso de días pasados y conserva los de hoy', () => {
    const days = [day('2026-11-08', [], [shift('o1', '14:00', undefined)]), day('2026-11-09', [], [shift('o2', '14:00', undefined), morning])]
    const result = dropStaleOpenShifts(days, '2026-11-09')
    expect(result[0]!.shifts).toEqual([])
    expect(result[1]!.shifts!.map(item => item.id)).toEqual(['o2', 's-am'])
  })
})

describe('sortShiftsForDisplay', () => {
  it('ordena por el orden de las plantillas y deja los sueltos al final por hora de inicio', () => {
    const early = template('t-1', '2:00 a 4:00 pm', '14:00', '16:00', 0)
    const late = template('t-2', '2:00 a 5:00 pm', '14:00', '17:00', 1)
    const shifts = [shift('b', '14:00', '17:00', 't-2'), shift('z', '20:00', '21:00'), shift('a', '14:00', '16:00', 't-1'), shift('y', '09:00', '10:00')]
    expect(sortShiftsForDisplay(shifts, [late, early]).map(item => item.id)).toEqual(['a', 'b', 'y', 'z'])
  })
  it('no modifica el arreglo original', () => {
    const shifts = [shift('b', '14:00', '17:00'), shift('a', '06:00', '08:00')]
    sortShiftsForDisplay(shifts, [])
    expect(shifts.map(item => item.id)).toEqual(['b', 'a'])
  })
})
