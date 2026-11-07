export interface Category {
  id: string
  name: string
  rateMode: 'direct' | 'derived'
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

/** Tarifa por km de una categoría: directa, o costo_total / intervalo_km. */
export function categoryRate(category: Category): number {
  if (category.rateMode === 'direct') return category.ratePerKm ?? 0
  const interval = category.intervalKm ?? 0
  return interval > 0 ? (category.totalCost ?? 0) / interval : 0
}

export function computeDay({ services, km, categories }: DayInput): DayResult {
  const gross = services.reduce((sum, serviceAmount) => sum + serviceAmount, 0)
  const costs = categories
    .filter(category => category.active)
    .map(category => {
      const rate = categoryRate(category)
      return { categoryId: category.id, name: category.name, rate, amount: km * rate }
    })
  const totalCost = costs.reduce((sum, costLine) => sum + costLine.amount, 0)
  return { gross, costs, totalCost, net: gross - totalCost }
}
