import { describe, it, expect } from 'vitest'
import { tripMinutes, formatDuration, validateTrip, sumDistance, hasTripData, tripTotal } from '../app/utils/trip'

describe('tripMinutes', () => {
  it('calcula la duración dentro del día', () => {
    expect(tripMinutes('08:00', '08:45')).toBe(45)
    expect(tripMinutes('09:10', '10:15')).toBe(65)
  })
  it('cruza la medianoche cuando el fin es menor que el inicio', () => {
    expect(tripMinutes('23:30', '00:20')).toBe(50)
  })
  it('inicio = fin es 0 minutos', () => {
    expect(tripMinutes('10:00', '10:00')).toBe(0)
  })
  it('devuelve null si falta o es inválida', () => {
    expect(tripMinutes('', '10:00')).toBeNull()
    expect(tripMinutes('10:00', null)).toBeNull()
    expect(tripMinutes('25:00', '10:00')).toBeNull()
    expect(tripMinutes('10:60', '11:00')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formatea minutos y horas', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(65)).toBe('1 h 05 min')
    expect(formatDuration(null)).toBe('')
  })
})

describe('validateTrip', () => {
  const ok = { startTime: '08:00', endTime: '08:30', distanceKm: 5, amount: 12000, shiftId: 'turno-1' }
  it('una fila completa es válida; los lugares son opcionales', () => {
    expect(validateTrip(ok)).toEqual({})
    expect(validateTrip({ ...ok, origin: 'A', destination: 'B' })).toEqual({})
  })
  it('distancia 0 es válida', () => {
    expect(validateTrip({ ...ok, distanceKm: 0 })).toEqual({})
  })
  it('marca cada obligatorio faltante con mensaje legible', () => {
    const errors = validateTrip({})
    expect(Object.keys(errors).sort()).toEqual(['amount', 'distanceKm', 'endTime', 'shiftId', 'startTime'])
    expect(errors.startTime).toBe('Falta la hora de recogida')
  })
  it('rechaza distancia negativa y monto no positivo', () => {
    expect(validateTrip({ ...ok, distanceKm: -1 }).distanceKm).toMatch(/negativa/)
    expect(validateTrip({ ...ok, amount: 0 }).amount).toMatch(/mayor que cero/)
  })
  it('rechaza horas mal formadas', () => {
    expect(validateTrip({ ...ok, startTime: '8am' }).startTime).toMatch(/inválida/)
  })
})

describe('sumDistance', () => {
  it('suma las distancias presentes', () => {
    expect(sumDistance([{ distanceKm: 3.5 }, { distanceKm: null }, {}, { distanceKm: 1.2 }])).toBe(4.7)
  })
  it('vacío = 0', () => {
    expect(sumDistance([])).toBe(0)
  })
})

describe('hasTripData', () => {
  it('detecta servicios viejos sin datos de viaje', () => {
    expect(hasTripData({})).toBe(false)
    expect(hasTripData({ distanceKm: 0 })).toBe(true)
    expect(hasTripData({ origin: 'x' })).toBe(true)
  })
})

describe('bonus del viaje', () => {
  const ok = { startTime: '08:00', endTime: '08:30', distanceKm: 5, amount: 10000, shiftId: 'turno-1' }
  it('es opcional: vacío, nulo o cero son válidos', () => {
    expect(validateTrip({ ...ok, bonus: null })).toEqual({})
    expect(validateTrip({ ...ok, bonus: 0 })).toEqual({})
    expect(validateTrip({ ...ok })).toEqual({})
  })
  it('negativo o no numérico da error legible', () => {
    expect(validateTrip({ ...ok, bonus: -1 }).bonus).toMatch(/negativo/)
    expect(validateTrip({ ...ok, bonus: Number.NaN }).bonus).toMatch(/inválido/)
  })
  it('tripTotal suma dinero y bonus (ausente cuenta 0)', () => {
    expect(tripTotal({ amount: 10000, bonus: 2000 })).toBe(12000)
    expect(tripTotal({ amount: 10000 })).toBe(10000)
  })
})

describe('turno obligatorio del viaje', () => {
  const valid = { startTime: '10:00', endTime: '10:30', distanceKm: 5, amount: 20 }
  it('sin turno da el error «Elige el turno del viaje»', () => {
    expect(validateTrip({ ...valid, shiftId: '' }).shiftId).toBe('Elige el turno del viaje')
    expect(validateTrip(valid).shiftId).toBe('Elige el turno del viaje')
  })
  it('con turno no hay error de turno', () => {
    expect(validateTrip({ ...valid, shiftId: 'a' }).shiftId).toBeUndefined()
  })
})
