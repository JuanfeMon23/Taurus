import { describe, it, expect } from 'vitest'
import { activeShiftTemplates, appliedTemplateIds, buildShiftFromTemplate, clockNow, defaultTripShiftId, loadLastShiftTemplateId, saveLastShiftTemplateId, tripsOfShift, unlinkShiftTrips, copyClosedShifts, findOpenShift, previousDay, shiftForTemplate, totalShiftMinutes, withShiftOnlyDays } from '../app/utils/shifts'
import type { Shift, ShiftTemplate } from '../app/services/types'

const shift = (startTime: string, endTime?: string): Shift => ({ id: startTime, date: '2026-11-06', startTime, ...(endTime ? { endTime } : {}) })

describe('turnos (utilidades)', () => {
  it('clockNow da HH:MM con ceros', () => {
    expect(clockNow(new Date(2026, 10, 7, 7, 5))).toBe('07:05')
  })
  it('previousDay cruza mes y año', () => {
    expect(previousDay('2026-11-01')).toBe('2026-10-31')
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
  })
  it('findOpenShift encuentra el turno sin fin', () => {
    expect(findOpenShift([shift('06:00', '10:00'), shift('14:00')])?.startTime).toBe('14:00')
    expect(findOpenShift([shift('06:00', '10:00')])).toBeUndefined()
  })
  it('totalShiftMinutes suma cerrados, cruces de medianoche y el en curso hasta now', () => {
    expect(totalShiftMinutes([shift('06:00', '10:00'), shift('22:00', '02:00')])).toBe(480)
    expect(totalShiftMinutes([shift('06:00', '10:00'), shift('14:00')])).toBe(240)
    expect(totalShiftMinutes([shift('06:00', '10:00'), shift('14:00')], '15:30')).toBe(330)
  })
  it('copyClosedShifts copia solo los cerrados a la nueva fecha, sin id', () => {
    const copies = copyClosedShifts([shift('06:00', '10:00'), shift('14:00')], '2026-11-07')
    expect(copies).toEqual([{ date: '2026-11-07', startTime: '06:00', endTime: '10:00' }])
  })
})

describe('activityNow', () => {
  it('da la hora solo si la fecha es hoy', async () => {
    const { activityNow } = await import('../app/utils/shifts')
    expect(activityNow('2026-11-07', '2026-11-07', '09:30')).toBe('09:30')
    expect(activityNow('2026-11-06', '2026-11-07', '09:30')).toBeUndefined()
  })
})

describe('withShiftOnlyDays', () => {
  it('crea días vacíos para fechas con solo turnos y no toca los existentes', () => {
    const existing = { date: '2026-11-06', km: 5, services: [{ amount: 100 }], costs: [], gross: 100, totalCost: 0, commission: 0, commissionVat: 0, net: 100 }
    const days = withShiftOnlyDays([existing], [shift('06:00', '10:00'), { ...shift('08:00', '12:00'), date: '2026-11-05' }])
    expect(days).toHaveLength(2)
    expect(days[0]).toBe(existing)
    expect(days[1]).toMatchObject({ date: '2026-11-05', services: [], gross: 0, net: 0, shifts: [{ startTime: '08:00' }] })
  })
})

const template = (id: string, startTime: string, endTime: string, overrides: Partial<ShiftTemplate> = {}): ShiftTemplate => ({
  id, name: `Turno ${id}`, startTime, endTime, sortOrder: 0, active: true, ...overrides,
})

describe('plantillas de turno', () => {
  it('activeShiftTemplates deja solo las activas, por orden y luego por hora de inicio', () => {
    const result = activeShiftTemplates([
      template('noche', '19:00', '23:00', { sortOrder: 2 }),
      template('mediodia', '12:00', '14:00', { sortOrder: 1 }),
      template('madrugada', '05:00', '08:00', { sortOrder: 1 }),
      template('vieja', '09:00', '10:00', { active: false }),
    ])
    expect(result.map(item => item.id)).toEqual(['madrugada', 'mediodia', 'noche'])
  })

  it('buildShiftFromTemplate crea el turno del día con las horas y el templateId de la plantilla', () => {
    expect(buildShiftFromTemplate(template('noche', '19:00', '23:00'), '2026-11-07')).toEqual({
      date: '2026-11-07', startTime: '19:00', endTime: '23:00', templateId: 'noche',
    })
  })

  it('appliedTemplateIds lista las plantillas con turno en el día; los sueltos no cuentan', () => {
    const applied = appliedTemplateIds([
      { ...shift('12:00', '14:00'), templateId: 'mediodia' },
      shift('16:00', '17:00'),
    ])
    expect([...applied]).toEqual(['mediodia'])
  })

  it('un turno ajustado (otras horas) sigue contando como la plantilla aplicada', () => {
    const adjusted = { ...shift('12:30', '14:30'), id: 'x', templateId: 'mediodia' }
    expect(shiftForTemplate([shift('08:00', '09:00'), adjusted], 'mediodia')).toBe(adjusted)
    expect(shiftForTemplate([adjusted], 'noche')).toBeUndefined()
  })

  it('copyClosedShifts conserva el templateId de los turnos copiados', () => {
    const copies = copyClosedShifts([{ ...shift('12:00', '14:00'), templateId: 'mediodia' }], '2026-11-07')
    expect(copies).toEqual([{ date: '2026-11-07', startTime: '12:00', endTime: '14:00', templateId: 'mediodia' }])
  })
})

describe('turno de un viaje', () => {
  const dayShift = (id: string, templateId?: string): Shift => ({ id, date: '2026-11-10', startTime: '06:00', endTime: '10:00', ...(templateId ? { templateId } : {}) })
  const trip = (id: string, shiftId?: string) => ({ id, amount: 10, ...(shiftId ? { shiftId } : {}) })

  it('defaultTripShiftId prefiere el turno de la última plantilla usada si está marcada', () => {
    const shifts = [dayShift('a', 'manana'), dayShift('b', 'noche')]
    expect(defaultTripShiftId(shifts, 'noche')).toBe('b')
  })
  it('defaultTripShiftId usa el único turno del día si la última plantilla no está marcada', () => {
    expect(defaultTripShiftId([dayShift('a', 'manana')], 'noche')).toBe('a')
    expect(defaultTripShiftId([dayShift('a')], undefined)).toBe('a')
  })
  it('defaultTripShiftId da vacío con varios turnos sin coincidencia o sin turnos', () => {
    expect(defaultTripShiftId([dayShift('a', 'manana'), dayShift('b', 'noche')], 'tarde')).toBe('')
    expect(defaultTripShiftId([dayShift('a', 'manana'), dayShift('b', 'noche')], undefined)).toBe('')
    expect(defaultTripShiftId([], 'noche')).toBe('')
  })
  it('tripsOfShift devuelve los viajes ligados al turno', () => {
    expect(tripsOfShift([trip('1', 'a'), trip('2', 'b'), trip('3')], 'a').map(item => item.id)).toEqual(['1'])
  })
  it('unlinkShiftTrips quita el shiftId solo de los viajes de ese turno, sin mutar', () => {
    const original = [trip('1', 'a'), trip('2', 'b')]
    const result = unlinkShiftTrips(original, 'a')
    expect(result[0]).not.toHaveProperty('shiftId')
    expect(result[1]?.shiftId).toBe('b')
    expect(original[0]?.shiftId).toBe('a')
  })
  it('recuerda la última plantilla en el storage y tolera storage roto', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) }
    expect(loadLastShiftTemplateId(storage)).toBeUndefined()
    saveLastShiftTemplateId('noche', storage)
    expect(loadLastShiftTemplateId(storage)).toBe('noche')
    const broken = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadLastShiftTemplateId(broken)).toBeUndefined()
    expect(() => saveLastShiftTemplateId('noche', broken)).not.toThrow()
  })
})
