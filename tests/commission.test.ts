import { describe, it, expect } from 'vitest'
import { computeCommission, dayNet, sumCommission, DEFAULT_RATES, validateRates, ratesToPercent, percentToRate } from '../app/utils/commission'

const rates = { commissionRate: 0.095, vatRate: 0.19 }

describe('computeCommission', () => {
  it('inDrive: 9.000 deja 855 de comisión y 162,45 de IVA', () => {
    expect(computeCommission(9000, true, rates)).toEqual({ commission: 855, commissionVat: 162.45 })
  })
  it('viaje propio: comisión e IVA en 0', () => {
    expect(computeCommission(9000, false, rates)).toEqual({ commission: 0, commissionVat: 0 })
  })
  it('redondea a 2 decimales', () => {
    expect(computeCommission(1234, true, rates)).toEqual({ commission: 117.23, commissionVat: 22.27 })
  })
  it('monto 0 o inválido da ceros', () => {
    expect(computeCommission(0, true, rates)).toEqual({ commission: 0, commissionVat: 0 })
    expect(computeCommission(Number.NaN, true, rates)).toEqual({ commission: 0, commissionVat: 0 })
  })
  it('tasas por defecto 9,5 % y 19 %', () => {
    expect(DEFAULT_RATES).toEqual(rates)
  })
})

describe('sumCommission y dayNet', () => {
  it('suma comisión e IVA de los viajes (ausentes cuentan 0)', () => {
    const total = sumCommission([{ commission: 855, commissionVat: 162.45 }, { commission: 100, commissionVat: 19 }, {}])
    expect(total).toEqual({ commission: 955, commissionVat: 181.45 })
  })
  it('neto = bruto − costos − comisión − IVA', () => {
    expect(dayNet(20000, 2000, 855, 162.45)).toBeCloseTo(16982.55, 6)
  })
})

describe('tasas en porcentaje', () => {
  it('convierte entre 0..1 y %', () => {
    expect(ratesToPercent(0.095)).toBe(9.5)
    expect(percentToRate(19)).toBe(0.19)
  })
  it('valida en español 0..100 %', () => {
    expect(validateRates({ commissionPercent: 9.5, vatPercent: 19 })).toEqual({})
    expect(validateRates({ commissionPercent: -1, vatPercent: 19 }).commissionPercent).toMatch(/entre 0 y 100/)
    expect(validateRates({ commissionPercent: 9.5, vatPercent: 101 }).vatPercent).toMatch(/entre 0 y 100/)
    expect(validateRates({ commissionPercent: null, vatPercent: 19 }).commissionPercent).toBe('Falta el porcentaje de comisión')
    expect(validateRates({ commissionPercent: 9.5, vatPercent: null }).vatPercent).toBe('Falta el porcentaje de IVA')
  })
})
