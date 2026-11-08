import { describe, it, expect } from 'vitest'
import { dayActivity, periodActivity } from '../app/utils/activity'

describe('dayActivity', () => {
  it('sin viajes con horas → todo en cero', () => {
    expect(dayActivity([{ id: 'a' }, { id: 'b', startTime: '10:00' }])).toEqual({
      segments: [], activeMinutes: 0, spanMinutes: 0, idleMinutes: 0, gaps: [], longestGap: 0, utilization: 0,
      hasShifts: false, shiftIntervals: [], shiftMinutes: 0, activeInShiftMinutes: 0, outOfShiftTrips: [],
    })
  })
  it('calcula activo, span, huecos y utilización', () => {
    const result = dayActivity([
      { id: 't2', startTime: '10:00', endTime: '10:30' },
      { id: 't1', startTime: '08:00', endTime: '09:00' },
      { id: 't3', startTime: '12:00', endTime: '13:00' },
      { id: 'sin', startTime: '', endTime: '' },
    ])
    expect(result.segments).toEqual([
      { startMinute: 480, endMinute: 540, tripId: 't1' },
      { startMinute: 600, endMinute: 630, tripId: 't2' },
      { startMinute: 720, endMinute: 780, tripId: 't3' },
    ])
    expect(result.activeMinutes).toBe(150)
    expect(result.spanMinutes).toBe(300)
    expect(result.idleMinutes).toBe(150)
    expect(result.gaps).toEqual([{ startMinute: 540, endMinute: 600 }, { startMinute: 630, endMinute: 720 }])
    expect(result.longestGap).toBe(90)
    expect(result.utilization).toBeCloseTo(0.5)
  })
  it('un viaje que cruza la medianoche termina después de 1440', () => {
    const result = dayActivity([{ id: 'n', startTime: '23:30', endTime: '00:20' }])
    expect(result.segments).toEqual([{ startMinute: 1410, endMinute: 1460, tripId: 'n' }])
    expect(result.activeMinutes).toBe(50)
    expect(result.utilization).toBe(1)
  })
  it('los solapes no cuentan doble', () => {
    const result = dayActivity([
      { id: 'a', startTime: '08:00', endTime: '09:00' },
      { id: 'b', startTime: '08:30', endTime: '09:30' },
    ])
    expect(result.activeMinutes).toBe(90)
    expect(result.spanMinutes).toBe(90)
    expect(result.idleMinutes).toBe(0)
    expect(result.gaps).toEqual([])
  })
  it('un viaje contenido en otro no extiende el span', () => {
    const result = dayActivity([
      { id: 'a', startTime: '08:00', endTime: '12:00' },
      { id: 'b', startTime: '09:00', endTime: '10:00' },
    ])
    expect(result.spanMinutes).toBe(240)
    expect(result.activeMinutes).toBe(240)
  })
})

describe('periodActivity', () => {
  it('totales, promedios y franja más productiva', () => {
    const dayOne = dayActivity([{ id: 'a', startTime: '08:30', endTime: '09:30' }, { id: 'b', startTime: '11:00', endTime: '11:30' }])
    const dayTwo = dayActivity([{ id: 'c', startTime: '08:00', endTime: '09:00' }])
    const result = periodActivity([dayOne, dayTwo, dayActivity([])])
    expect(result.workedDays).toBe(2)
    expect(result.activeMinutes).toBe(150)
    expect(result.spanMinutes).toBe(180 + 60)
    expect(result.idleMinutes).toBe(90)
    expect(result.avgActiveMinutes).toBe(75)
    expect(result.avgIdleMinutes).toBe(45)
    expect(result.utilization).toBeCloseTo(0.625)
    expect(result.hourlyActivity).toHaveLength(24)
    expect(result.hourlyActivity[8]).toBe(30 + 60)
    expect(result.hourlyActivity[9]).toBe(30)
    expect(result.hourlyActivity[11]).toBe(30)
    expect(result.bestHour).toBe(8)
  })
  it('reparte los minutos tras medianoche en las horas 0..23', () => {
    const result = periodActivity([dayActivity([{ id: 'n', startTime: '23:30', endTime: '00:20' }])])
    expect(result.hourlyActivity[23]).toBe(30)
    expect(result.hourlyActivity[0]).toBe(20)
  })
  it('sin días → ceros y bestHour null', () => {
    expect(periodActivity([])).toMatchObject({ workedDays: 0, activeMinutes: 0, avgActiveMinutes: 0, utilization: 0, bestHour: null })
  })
})

describe('dayActivity con turnos', () => {
  const shifts = [
    { startTime: '08:00', endTime: '09:30' },
    { startTime: '04:30', endTime: '07:30' },
    { startTime: '14:30', endTime: '17:00' },
  ]
  it('métricas solo sobre el tiempo en turno; viajes fuera de turno cuentan como activos', () => {
    const result = dayActivity([
      { id: 'in', startTime: '08:30', endTime: '09:00' },
      { id: 'partial', startTime: '07:15', endTime: '07:45' },
      { id: 'out', startTime: '12:00', endTime: '12:20' },
    ], shifts)
    expect(result.hasShifts).toBe(true)
    expect(result.shiftMinutes).toBe(180 + 90 + 150)
    expect(result.activeMinutes).toBe(30 + 30 + 20)
    expect(result.activeInShiftMinutes).toBe(30 + 15)
    expect(result.idleMinutes).toBe(420 - 45)
    expect(result.spanMinutes).toBe(420)
    expect(result.utilization).toBeCloseTo(45 / 420)
    expect(result.outOfShiftTrips).toEqual(['partial', 'out'])
  })
  it('los huecos son solo los de dentro de turnos', () => {
    const result = dayActivity([{ id: 'a', startTime: '08:30', endTime: '09:00' }], [{ startTime: '08:00', endTime: '10:00' }, { startTime: '14:00', endTime: '15:00' }])
    expect(result.gaps).toEqual([
      { startMinute: 480, endMinute: 510 },
      { startMinute: 540, endMinute: 600 },
      { startMinute: 840, endMinute: 900 },
    ])
    expect(result.longestGap).toBe(60)
  })
  it('turnos solapados no cuentan doble', () => {
    const result = dayActivity([], [{ startTime: '08:00', endTime: '10:00' }, { startTime: '09:00', endTime: '11:00' }])
    expect(result.shiftMinutes).toBe(180)
    expect(result.shiftIntervals).toEqual([{ startMinute: 480, endMinute: 660 }])
    expect(result.idleMinutes).toBe(180)
    expect(result.utilization).toBe(0)
  })
  it('turno que cruza la medianoche', () => {
    const result = dayActivity([{ id: 'n', startTime: '23:30', endTime: '00:20' }], [{ startTime: '23:00', endTime: '01:00' }])
    expect(result.shiftMinutes).toBe(120)
    expect(result.activeInShiftMinutes).toBe(50)
    expect(result.outOfShiftTrips).toEqual([])
  })
  it('turno en curso: se cierra en now; sin now se ignora', () => {
    const ongoing = [{ startTime: '08:00' }]
    expect(dayActivity([], ongoing, '09:30').shiftMinutes).toBe(90)
    expect(dayActivity([{ id: 'a', startTime: '08:00', endTime: '08:30' }], ongoing)).toMatchObject({ hasShifts: false, spanMinutes: 30 })
  })
  it('sin turnos conserva el comportamiento por lapso', () => {
    expect(dayActivity([{ id: 'a', startTime: '08:00', endTime: '09:00' }], [])).toMatchObject({ hasShifts: false, spanMinutes: 60, shiftMinutes: 0, outOfShiftTrips: [] })
  })
})

describe('periodActivity con turnos', () => {
  it('suma en turno, cuenta días sin turnos y normaliza por hora', () => {
    const withShifts = dayActivity([{ id: 'a', startTime: '08:00', endTime: '08:30' }, { id: 'o', startTime: '12:00', endTime: '12:30' }], [{ startTime: '08:00', endTime: '10:00' }])
    const withoutShifts = dayActivity([{ id: 'b', startTime: '08:00', endTime: '09:00' }])
    const result = periodActivity([withShifts, withoutShifts])
    expect(result.daysWithoutShifts).toBe(1)
    expect(result.workedDays).toBe(2)
    expect(result.shiftMinutes).toBe(120)
    expect(result.activeInShiftMinutes).toBe(30)
    expect(result.activeMinutes).toBe(60 + 60)
    expect(result.spanMinutes).toBe(120 + 60)
    expect(result.idleMinutes).toBe(90 + 0)
    expect(result.utilization).toBeCloseTo((30 + 60) / 180)
    expect(result.hourlyActivity[12]).toBe(0)
    expect(result.hourlyActivity[8]).toBe(30 + 60)
    expect(result.hourlyShiftMinutes[8]).toBe(60)
    expect(result.hourlyShiftMinutes[9]).toBe(60)
    expect(result.outOfShiftTripCount).toBe(1)
  })
  it('bestHour usa proporción activo/turno en horas con >= 30 min de turno', () => {
    const day = dayActivity(
      [{ id: 'a', startTime: '08:00', endTime: '08:30' }, { id: 'b', startTime: '09:00', endTime: '09:50' }, { id: 'c', startTime: '10:00', endTime: '10:05' }],
      [{ startTime: '08:00', endTime: '11:00' }],
    )
    // hora 8: 30/60, hora 9: 50/60, hora 10: 5/60
    expect(periodActivity([day]).bestHour).toBe(9)
  })
  it('hora con menos de 30 min de turno no califica', () => {
    const day = dayActivity(
      [{ id: 'a', startTime: '08:00', endTime: '08:20' }, { id: 'b', startTime: '09:00', endTime: '09:10' }],
      [{ startTime: '08:00', endTime: '08:20' }, { startTime: '09:00', endTime: '10:00' }],
    )
    expect(periodActivity([day]).bestHour).toBe(9)
  })
  it('día con turno y sin viajes cuenta como trabajado', () => {
    const result = periodActivity([dayActivity([], [{ startTime: '08:00', endTime: '09:00' }])])
    expect(result).toMatchObject({ workedDays: 1, idleMinutes: 60, utilization: 0, bestHour: null })
  })
})
