import { describe, it, expect } from 'vitest'
import { upsertTrip, removeTrip, dayTotals, dayKm, extraKmFrom, sortTrips, tripSummary } from '../app/utils/dayTrips'
import type { Category } from '../app/utils/calc'

const buildTrip = (overrides: Record<string, unknown> = {}) => ({ id: 'a', amount: 10000, method: 'cash' as const, startTime: '08:00', endTime: '08:30', distanceKm: 5, ...overrides })

describe('upsertTrip', () => {
  it('agrega un viaje sin id al final sin mutar la lista original', () => {
    const list = [buildTrip()]
    const result = upsertTrip(list, { amount: 5000, startTime: '09:00', endTime: '09:10', distanceKm: 2 })
    expect(result).toHaveLength(2)
    expect(list).toHaveLength(1)
    expect(result[1]!.id).toBeUndefined()
  })
  it('reemplaza el viaje con el mismo id conservándolo en su posición', () => {
    const result = upsertTrip([buildTrip({ id: 'a' }), buildTrip({ id: 'b' })], buildTrip({ id: 'a', amount: 99 }))
    expect(result.map(trip => trip.id)).toEqual(['a', 'b'])
    expect(result[0]!.amount).toBe(99)
  })
  it('un id desconocido se agrega', () => {
    expect(upsertTrip([buildTrip()], buildTrip({ id: 'z' }))).toHaveLength(2)
  })
})

describe('removeTrip', () => {
  it('quita el viaje por id', () => {
    expect(removeTrip([buildTrip({ id: 'a' }), buildTrip({ id: 'b' })], 'a').map(trip => trip.id)).toEqual(['b'])
  })
  it('id inexistente deja la lista igual', () => {
    expect(removeTrip([buildTrip()], 'zzz')).toHaveLength(1)
  })
})

describe('sortTrips', () => {
  it('ordena de la hora de recogida más tardía a la más temprana y deja sin hora al final', () => {
    const result = sortTrips([buildTrip({ id: 'c', startTime: undefined }), buildTrip({ id: 'b', startTime: '10:00' }), buildTrip({ id: 'a', startTime: '07:30' })])
    expect(result.map(trip => trip.id)).toEqual(['b', 'a', 'c'])
  })
  it('el último viaje queda primero y no muta la lista', () => {
    const list = [buildTrip({ id: 'a', startTime: '08:00' }), buildTrip({ id: 'b', startTime: '09:15' }), buildTrip({ id: 'c', startTime: '12:00' }), buildTrip({ id: 'd', startTime: undefined })]
    expect(sortTrips(list).map(trip => trip.id)).toEqual(['c', 'b', 'a', 'd'])
    expect(list.map(trip => trip.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('dayTotals', () => {
  const categories: Category[] = [{ id: 'g', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }]
  it('suma viajes, km, bruto, costos y neto con el km del día', () => {
    const totals = dayTotals([buildTrip({ amount: 10000 }), buildTrip({ id: 'b', amount: 5000 })], 20, categories)
    expect(totals).toMatchObject({ count: 2, tripKm: 10, km: 20, gross: 15000, totalCost: 2000, net: 13000 })
  })
  it('el bruto incluye el bonus y se informa el bonus del día', () => {
    const totals = dayTotals([buildTrip({ amount: 10000, bonus: 2000 }), buildTrip({ id: 'b', amount: 5000 })], 20, categories)
    expect(totals).toMatchObject({ gross: 17000, bonus: 2000, totalCost: 2000, net: 15000 })
  })
  it('descuenta comisión e IVA del neto y los informa', () => {
    const totals = dayTotals([buildTrip({ amount: 10000, commission: 950, commissionVat: 180.5 }), buildTrip({ id: 'b', amount: 5000, isIndrive: false })], 20, categories)
    expect(totals).toMatchObject({ gross: 15000, totalCost: 2000, commission: 950, commissionVat: 180.5 })
    expect(totals.net).toBeCloseTo(11869.5, 6)
  })
  it('día vacío da ceros', () => {
    expect(dayTotals([], 0, categories)).toMatchObject({ count: 0, gross: 0, totalCost: 0, net: 0 })
  })
  it('neto negativo si el costo supera el bruto', () => {
    expect(dayTotals([buildTrip({ amount: 100 })], 50, categories).net).toBe(-4900)
  })
})

describe('dayKm', () => {
  it('sin viajes es solo el extra', () => {
    expect(dayKm([], 7)).toBe(7)
  })
  it('suma la distancia de los viajes y el extra', () => {
    expect(dayKm([buildTrip({ distanceKm: 5 }), buildTrip({ id: 'b', distanceKm: 3 })], 4)).toBe(12)
  })
  it('admite decimales', () => {
    expect(dayKm([buildTrip({ distanceKm: 2.5 })], 1.25)).toBeCloseTo(3.75)
  })
  it('extra vacío o negativo cuenta como 0', () => {
    expect(dayKm([buildTrip({ distanceKm: 5 })], -3)).toBe(5)
    expect(dayKm([buildTrip({ distanceKm: 5 })], Number.NaN)).toBe(5)
  })
})

describe('extraKmFrom', () => {
  it('sin viajes todo el km guardado es extra', () => {
    expect(extraKmFrom(12, [])).toBe(12)
  })
  it('km guardado menos la suma de viajes', () => {
    expect(extraKmFrom(12, [buildTrip({ distanceKm: 5 }), buildTrip({ id: 'b', distanceKm: 3 })])).toBe(4)
  })
  it('km guardado menor que la suma da 0', () => {
    expect(extraKmFrom(3, [buildTrip({ distanceKm: 5 })])).toBe(0)
  })
  it('decimales sin ruido de coma flotante', () => {
    expect(extraKmFrom(0.3, [buildTrip({ distanceKm: 0.1 }), buildTrip({ id: 'b', distanceKm: 0.2 })])).toBe(0)
    expect(extraKmFrom(3.75, [buildTrip({ distanceKm: 2.5 })])).toBeCloseTo(1.25)
  })
})

describe('tripSummary', () => {
  it('arma horario, duración y trayecto', () => {
    expect(tripSummary(buildTrip({ origin: 'A', destination: 'B' }))).toEqual({ schedule: '08:00–08:30', duration: '30 min', route: 'A → B' })
  })
  it('servicio sin datos de viaje no tiene horario ni duración', () => {
    expect(tripSummary({ amount: 1 })).toEqual({ schedule: '', duration: '', route: '' })
  })
})
