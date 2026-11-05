import { describe, it, expect } from 'vitest'
import { upsertTrip, removeTrip, dayTotals, dayKm, extraKmFrom, sortTrips, tripSummary } from '../app/utils/dayTrips'
import type { Category } from '../app/utils/calc'

const t = (over: Record<string, unknown> = {}) => ({ id: 'a', amount: 10000, method: 'cash' as const, startTime: '08:00', endTime: '08:30', distanceKm: 5, ...over })

describe('upsertTrip', () => {
  it('agrega un viaje sin id al final sin mutar la lista original', () => {
    const list = [t()]
    const out = upsertTrip(list, { amount: 5000, startTime: '09:00', endTime: '09:10', distanceKm: 2 })
    expect(out).toHaveLength(2)
    expect(list).toHaveLength(1)
    expect(out[1]!.id).toBeUndefined()
  })
  it('reemplaza el viaje con el mismo id conservándolo en su posición', () => {
    const out = upsertTrip([t({ id: 'a' }), t({ id: 'b' })], t({ id: 'a', amount: 99 }))
    expect(out.map(x => x.id)).toEqual(['a', 'b'])
    expect(out[0]!.amount).toBe(99)
  })
  it('un id desconocido se agrega', () => {
    expect(upsertTrip([t()], t({ id: 'z' }))).toHaveLength(2)
  })
})

describe('removeTrip', () => {
  it('quita el viaje por id', () => {
    expect(removeTrip([t({ id: 'a' }), t({ id: 'b' })], 'a').map(x => x.id)).toEqual(['b'])
  })
  it('id inexistente deja la lista igual', () => {
    expect(removeTrip([t()], 'zzz')).toHaveLength(1)
  })
})

describe('sortTrips', () => {
  it('ordena por hora de recogida y deja sin hora al final', () => {
    const out = sortTrips([t({ id: 'c', startTime: undefined }), t({ id: 'b', startTime: '10:00' }), t({ id: 'a', startTime: '07:30' })])
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('dayTotals', () => {
  const cats: Category[] = [{ id: 'g', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }]
  it('suma viajes, km, bruto, costos y neto con el km del día', () => {
    const r = dayTotals([t({ amount: 10000 }), t({ id: 'b', amount: 5000 })], 20, cats)
    expect(r).toMatchObject({ count: 2, tripKm: 10, km: 20, gross: 15000, totalCost: 2000, net: 13000 })
  })
  it('el bruto incluye el bonus y se informa el bonus del día', () => {
    const r = dayTotals([t({ amount: 10000, bonus: 2000 }), t({ id: 'b', amount: 5000 })], 20, cats)
    expect(r).toMatchObject({ gross: 17000, bonus: 2000, totalCost: 2000, net: 15000 })
  })
  it('día vacío da ceros', () => {
    expect(dayTotals([], 0, cats)).toMatchObject({ count: 0, gross: 0, totalCost: 0, net: 0 })
  })
  it('neto negativo si el costo supera el bruto', () => {
    expect(dayTotals([t({ amount: 100 })], 50, cats).net).toBe(-4900)
  })
})

describe('dayKm', () => {
  it('sin viajes es solo el extra', () => {
    expect(dayKm([], 7)).toBe(7)
  })
  it('suma la distancia de los viajes y el extra', () => {
    expect(dayKm([t({ distanceKm: 5 }), t({ id: 'b', distanceKm: 3 })], 4)).toBe(12)
  })
  it('admite decimales', () => {
    expect(dayKm([t({ distanceKm: 2.5 })], 1.25)).toBeCloseTo(3.75)
  })
  it('extra vacío o negativo cuenta como 0', () => {
    expect(dayKm([t({ distanceKm: 5 })], -3)).toBe(5)
    expect(dayKm([t({ distanceKm: 5 })], Number.NaN)).toBe(5)
  })
})

describe('extraKmFrom', () => {
  it('sin viajes todo el km guardado es extra', () => {
    expect(extraKmFrom(12, [])).toBe(12)
  })
  it('km guardado menos la suma de viajes', () => {
    expect(extraKmFrom(12, [t({ distanceKm: 5 }), t({ id: 'b', distanceKm: 3 })])).toBe(4)
  })
  it('km guardado menor que la suma da 0', () => {
    expect(extraKmFrom(3, [t({ distanceKm: 5 })])).toBe(0)
  })
  it('decimales sin ruido de coma flotante', () => {
    expect(extraKmFrom(0.3, [t({ distanceKm: 0.1 }), t({ id: 'b', distanceKm: 0.2 })])).toBe(0)
    expect(extraKmFrom(3.75, [t({ distanceKm: 2.5 })])).toBeCloseTo(1.25)
  })
})

describe('tripSummary', () => {
  it('arma horario, duración y trayecto', () => {
    expect(tripSummary(t({ origin: 'A', destination: 'B' }))).toEqual({ schedule: '08:00–08:30', duration: '30 min', route: 'A → B' })
  })
  it('servicio sin datos de viaje no tiene horario ni duración', () => {
    expect(tripSummary({ amount: 1 })).toEqual({ schedule: '', duration: '', route: '' })
  })
})
