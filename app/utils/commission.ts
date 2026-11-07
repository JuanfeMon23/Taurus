/** Lógica pura de la comisión inDrive: comisión e IVA por viaje, neto del día y tasas en porcentaje. */

export interface CommissionRates {
  /** Fracción 0..1 sobre el dinero del viaje sin bonus. */
  commissionRate: number
  /** Fracción 0..1 sobre la comisión. */
  vatRate: number
}

export interface CommissionAmounts {
  commission: number
  commissionVat: number
}

export const DEFAULT_RATES: CommissionRates = { commissionRate: 0.095, vatRate: 0.19 }

const roundCents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** Comisión = round(dinero sin bonus × tasa, 2); IVA = round(comisión × tasa de IVA, 2). Viaje propio: ceros. */
export function computeCommission(amount: number, isIndrive: boolean, rates: CommissionRates): CommissionAmounts {
  if (!isIndrive || !Number.isFinite(amount) || amount <= 0) return { commission: 0, commissionVat: 0 }
  const commission = roundCents(amount * rates.commissionRate)
  return { commission, commissionVat: roundCents(commission * rates.vatRate) }
}

/** Suma de comisión e IVA de los viajes (campos ausentes cuentan 0). */
export function sumCommission(trips: { commission?: number; commissionVat?: number }[]): CommissionAmounts {
  const commission = trips.reduce((total, trip) => total + (trip.commission ?? 0), 0)
  const commissionVat = trips.reduce((total, trip) => total + (trip.commissionVat ?? 0), 0)
  return { commission: roundCents(commission), commissionVat: roundCents(commissionVat) }
}

/** Neto del día = bruto − costos por km − comisión − IVA de la comisión. Fuente única para Hoy, Historial y Estadísticas. */
export const dayNet = (gross: number, totalCost: number, commission: number, commissionVat: number): number =>
  Math.round((gross - totalCost - commission - commissionVat) * 1e9) / 1e9

export const ratesToPercent = (rate: number): number => Math.round(rate * 100 * 1e6) / 1e6
export const percentToRate = (percent: number): number => Math.round((percent / 100) * 1e8) / 1e8

export interface RatesFormErrors {
  commissionPercent?: string
  vatPercent?: string
}

/** Valida los porcentajes del formulario de Tarifas (0 a 100). */
export function validateRates(form: { commissionPercent: number | null; vatPercent: number | null }): RatesFormErrors {
  const errors: RatesFormErrors = {}
  const check = (value: number | null, missing: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return missing
    if (value < 0 || value > 100) return 'El porcentaje debe estar entre 0 y 100'
    return undefined
  }
  const commissionError = check(form.commissionPercent, 'Falta el porcentaje de comisión')
  const vatError = check(form.vatPercent, 'Falta el porcentaje de IVA')
  if (commissionError) errors.commissionPercent = commissionError
  if (vatError) errors.vatPercent = vatError
  return errors
}
