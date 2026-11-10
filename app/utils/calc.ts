import type { RateMode } from '../services/types'

export interface Category {
  id: string
  name: string
  /** Código del catálogo `rateModes`; sus marcas dicen qué campos usa la tarifa. */
  rateMode: string
  ratePerKm?: number
  totalCost?: number
  intervalKm?: number
  active: boolean
  /** Metadatos de sincronización (ver services/types.ts). */
  updatedAt?: string
  deleted?: boolean
}

export interface DayInput {
  services: number[]
  km: number
  categories: Category[]
  /** Catálogo de modos de tarifa (decide cómo se calcula cada categoría). */
  rateModes: RateMode[]
}

export interface CostLine {
  categoryId: string
  name: string
  rate: number
  amount: number
}

export interface DayResult {
  gross: number
  costs: CostLine[]
  totalCost: number
  net: number
}

/**
 * Tarifa por km de una categoría según las marcas de su modo: `usesRatePerKm` suma el valor por km y `usesCostInterval`
 * suma costo_total / intervalo_km. Un modo que no está en el catálogo (sync pendiente) o sin marcas vale 0.
 */
export function categoryRate(category: Category, rateModes: RateMode[]): number {
  const mode = rateModes.find(candidate => candidate.id === category.rateMode)
  if (!mode) return 0
  let total = 0
  if (mode.usesRatePerKm) total += category.ratePerKm ?? 0
  if (mode.usesCostInterval) {
    const interval = category.intervalKm ?? 0
    if (interval > 0) total += (category.totalCost ?? 0) / interval
  }
  return total
}

export function computeDay({ services, km, categories, rateModes }: DayInput): DayResult {
  const gross = services.reduce((sum, serviceAmount) => sum + serviceAmount, 0)
  const costs = categories
    .filter(category => category.active)
    .map(category => {
      const rate = categoryRate(category, rateModes)
      return { categoryId: category.id, name: category.name, rate, amount: km * rate }
    })
  const totalCost = costs.reduce((sum, costLine) => sum + costLine.amount, 0)
  return { gross, costs, totalCost, net: gross - totalCost }
}
