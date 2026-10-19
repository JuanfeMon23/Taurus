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
export function categoryRate(c: Category): number {
  if (c.rateMode === 'direct') return c.ratePerKm ?? 0
  const interval = c.intervalKm ?? 0
  return interval > 0 ? (c.totalCost ?? 0) / interval : 0
}

export function computeDay({ services, km, categories }: DayInput): DayResult {
  const gross = services.reduce((sum, s) => sum + s, 0)
  const costs = categories
    .filter(c => c.active)
    .map(c => {
      const rate = categoryRate(c)
      return { categoryId: c.id, name: c.name, rate, amount: km * rate }
    })
  const totalCost = costs.reduce((sum, c) => sum + c.amount, 0)
  return { gross, costs, totalCost, net: gross - totalCost }
}
