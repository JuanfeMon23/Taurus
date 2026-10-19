import type { DayRecord } from '../services/types'

export type Granularity = 'day' | 'month' | 'year'

export interface Bucket {
  key: string
  gross: number
  totalCost: number
  net: number
  km: number
  days: number
  costs: Map<string, { name: string; amount: number }>
}

export interface Summary {
  gross: number
  totalCost: number
  net: number
  km: number
  days: number
  avgNet: number
  netPerKm: number
  best: DayRecord | null
}

const LEN = { day: 10, month: 7, year: 4 } as const

/** Trunca YYYY-MM-DD al bucket: día, YYYY-MM o YYYY. */
export const bucketKey = (date: string, g: Granularity) => date.slice(0, LEN[g])

/** Agrupa días en buckets cronológicos con totales y costos por categoría. */
export function aggregate(days: DayRecord[], g: Granularity): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const d of days) {
    const key = bucketKey(d.date, g)
    let b = map.get(key)
    if (!b) {
      b = { key, gross: 0, totalCost: 0, net: 0, km: 0, days: 0, costs: new Map() }
      map.set(key, b)
    }
    b.gross += d.gross
    b.totalCost += d.totalCost
    b.net += d.net
    b.km += d.km
    b.days += 1
    for (const c of d.costs) {
      const prev = b.costs.get(c.categoryId)
      b.costs.set(c.categoryId, { name: c.name, amount: (prev?.amount ?? 0) + c.amount })
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function summarize(days: DayRecord[]): Summary {
  const s = days.reduce(
    (acc, d) => ({ gross: acc.gross + d.gross, totalCost: acc.totalCost + d.totalCost, net: acc.net + d.net, km: acc.km + d.km }),
    { gross: 0, totalCost: 0, net: 0, km: 0 },
  )
  const best = days.reduce<DayRecord | null>((m, d) => (!m || d.net > m.net ? d : m), null)
  return {
    ...s,
    days: days.length,
    avgNet: days.length ? s.net / days.length : 0,
    netPerKm: s.km ? s.net / s.km : 0,
    best,
  }
}
