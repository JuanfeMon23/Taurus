import type { DayRecord } from '../services/types'

export type Granularity = 'day' | 'month' | 'year'

export interface Bucket {
  key: string
  gross: number
  totalCost: number
  /** Comisión inDrive + IVA (ya descontados del neto). */
  commission: number
  net: number
  km: number
  days: number
  costs: Map<string, { name: string; amount: number }>
}

export interface Summary {
  gross: number
  totalCost: number
  /** Comisión inDrive + IVA (ya descontados del neto). */
  commission: number
  net: number
  km: number
  days: number
  avgNet: number
  netPerKm: number
  best: DayRecord | null
}

const LEN = { day: 10, month: 7, year: 4 } as const

/** Trunca YYYY-MM-DD al bucket: día, YYYY-MM o YYYY. */
export const bucketKey = (date: string, granularity: Granularity) => date.slice(0, LEN[granularity])

/** Agrupa días en buckets cronológicos con totales y costos por categoría. */
export function aggregate(days: DayRecord[], granularity: Granularity): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const day of days) {
    const key = bucketKey(day.date, granularity)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { key, gross: 0, totalCost: 0, commission: 0, net: 0, km: 0, days: 0, costs: new Map() }
      map.set(key, bucket)
    }
    bucket.gross += day.gross
    bucket.totalCost += day.totalCost
    bucket.commission += day.commission + day.commissionVat
    bucket.net += day.net
    bucket.km += day.km
    bucket.days += 1
    for (const cost of day.costs) {
      const previousCost = bucket.costs.get(cost.categoryId)
      bucket.costs.set(cost.categoryId, { name: cost.name, amount: (previousCost?.amount ?? 0) + cost.amount })
    }
  }
  return [...map.values()].sort((first, second) => first.key.localeCompare(second.key))
}

export function summarize(days: DayRecord[]): Summary {
  const totals = days.reduce(
    (acc, day) => ({ gross: acc.gross + day.gross, totalCost: acc.totalCost + day.totalCost, commission: acc.commission + day.commission + day.commissionVat, net: acc.net + day.net, km: acc.km + day.km }),
    { gross: 0, totalCost: 0, commission: 0, net: 0, km: 0 },
  )
  const best = days.reduce<DayRecord | null>((bestSoFar, day) => (!bestSoFar || day.net > bestSoFar.net ? day : bestSoFar), null)
  return {
    ...totals,
    days: days.length,
    avgNet: days.length ? totals.net / days.length : 0,
    netPerKm: totals.km ? totals.net / totals.km : 0,
    best,
  }
}
