import type { DayRecord } from '../services/types'
import { tripTotal } from './trip'

export type Granularity = 'day' | 'week' | 'month' | 'year'

/** Gasto vario (fuera de los costos por km) que se resta del neto en estadísticas. */
export interface StatsExpense {
  date: string
  amount: number
  /** Id de `expenseCategories`; ausente = sin categoría. */
  categoryId?: string
  method?: string
}

export interface StatsOptions {
  /** Medio de pago de los viajes que no traen uno (el primero activo del catálogo). */
  defaultMethodId?: string
}

export const UNCATEGORIZED_EXPENSE = 'Sin categoría'

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
  /** Ingresos (viaje + bonus) por código de medio de pago. */
  incomeByMethod: Map<string, number>
  /** Gastos varios del periodo, total y por categoryId (`UNCATEGORIZED_EXPENSE` si no tiene). */
  expenses: number
  expensesByCategory: Map<string, number>
  /** net − expenses. */
  netAfterExpenses: number
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
  /** Ingresos (viaje + bonus) por código de medio de pago. */
  incomeByMethod: Map<string, number>
  expenses: number
  expensesByCategory: Map<string, number>
  netAfterExpenses: number
}

const LEN = { day: 10, month: 7, year: 4 } as const

const DAY_MS = 86_400_000

/** Semana ISO (lunes a domingo) de YYYY-MM-DD como AAAA-Www; el año es el ISO. */
function isoWeekKey(date: string): string {
  const [year = 0, month = 1, day = 1] = date.slice(0, 10).split('-').map(Number)
  const current = new Date(Date.UTC(year, month - 1, day))
  const weekday = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + 4 - weekday) // jueves de esa semana
  const isoYear = current.getUTCFullYear()
  const week = Math.ceil(((current.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/** Trunca YYYY-MM-DD al bucket: día, semana ISO (AAAA-Www), YYYY-MM o YYYY. */
export const bucketKey = (date: string, granularity: Granularity) =>
  granularity === 'week' ? isoWeekKey(date) : date.slice(0, LEN[granularity])

/** Suma los ingresos del día por código de medio; sin medio usa `defaultMethodId` (o '' si no hay). */
function addIncome(target: Map<string, number>, day: DayRecord, defaultMethodId = '') {
  for (const service of day.services) {
    const methodId = service.method ?? defaultMethodId
    target.set(methodId, (target.get(methodId) ?? 0) + tripTotal(service))
  }
}

function addExpenses(target: { expenses: number; expensesByCategory: Map<string, number> }, expenses: StatsExpense[]) {
  for (const expense of expenses) {
    const category = expense.categoryId?.trim() || UNCATEGORIZED_EXPENSE
    target.expenses += expense.amount
    target.expensesByCategory.set(category, (target.expensesByCategory.get(category) ?? 0) + expense.amount)
  }
}

const emptyBucket = (key: string): Bucket => ({
  key, gross: 0, totalCost: 0, commission: 0, net: 0, km: 0, days: 0, costs: new Map(),
  incomeByMethod: new Map(), expenses: 0, expensesByCategory: new Map(), netAfterExpenses: 0,
})

/** Agrupa días (y gastos varios) en buckets cronológicos con totales y costos por categoría. */
export function aggregate(days: DayRecord[], granularity: Granularity, expenses: StatsExpense[] = [], options: StatsOptions = {}): Bucket[] {
  const map = new Map<string, Bucket>()
  const bucketFor = (date: string) => {
    const key = bucketKey(date, granularity)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = emptyBucket(key)
      map.set(key, bucket)
    }
    return bucket
  }
  for (const day of days) {
    const bucket = bucketFor(day.date)
    bucket.gross += day.gross
    bucket.totalCost += day.totalCost
    bucket.commission += day.commission + day.commissionVat
    bucket.net += day.net
    bucket.km += day.km
    bucket.days += 1
    addIncome(bucket.incomeByMethod, day, options.defaultMethodId)
    for (const cost of day.costs) {
      const previousCost = bucket.costs.get(cost.categoryId)
      bucket.costs.set(cost.categoryId, { name: cost.name, amount: (previousCost?.amount ?? 0) + cost.amount })
    }
  }
  for (const expense of expenses) addExpenses(bucketFor(expense.date), [expense])
  for (const bucket of map.values()) bucket.netAfterExpenses = bucket.net - bucket.expenses
  return [...map.values()].sort((first, second) => first.key.localeCompare(second.key))
}

export function summarize(days: DayRecord[], expenses: StatsExpense[] = [], options: StatsOptions = {}): Summary {
  const totals = days.reduce(
    (acc, day) => ({
      gross: acc.gross + day.gross,
      totalCost: acc.totalCost + day.totalCost,
      commission: acc.commission + day.commission + day.commissionVat,
      net: acc.net + day.net,
      km: acc.km + day.km,
    }),
    { gross: 0, totalCost: 0, commission: 0, net: 0, km: 0 },
  )
  const incomeByMethod = new Map<string, number>()
  for (const day of days) addIncome(incomeByMethod, day, options.defaultMethodId)
  const spending = { expenses: 0, expensesByCategory: new Map<string, number>() }
  addExpenses(spending, expenses)
  const best = days.reduce<DayRecord | null>((bestSoFar, day) => (!bestSoFar || day.net > bestSoFar.net ? day : bestSoFar), null)
  return {
    ...totals,
    incomeByMethod,
    ...spending,
    netAfterExpenses: totals.net - spending.expenses,
    days: days.length,
    avgNet: days.length ? totals.net / days.length : 0,
    netPerKm: totals.km ? totals.net / totals.km : 0,
    best,
  }
}
