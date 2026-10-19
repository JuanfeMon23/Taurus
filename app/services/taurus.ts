import { computeDay, type Category } from '../utils/calc'
import { EPOCH, newId, now } from './ids'
import { upsert } from './memoryStore'
import { same } from './merge'
import type {
  CashDay, CashMeta, CategoryRec, DayMeta, DayRecord, MovementRec, NewCategory, Repo, Service, ServiceRec, Snapshot, Store,
} from './types'

export interface DayInput {
  date: string
  km: number
  note?: string
  services: Service[]
}

const SEED: CategoryRec[] = [
  { id: 'cat-gasolina', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true, updatedAt: EPOCH },
  { id: 'cat-servicio-moto', name: 'Servicio moto', rateMode: 'derived', totalCost: 160000, intervalKm: 3500, active: true, updatedAt: EPOCH },
]

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted)

/**
 * Sincroniza una lista hija (servicios de un día, movimientos de una caja):
 * conserva ids, actualiza solo lo que cambió y deja lápida de lo que se quitó.
 */
function diffChildren<R extends { id: string; updatedAt: string; deleted?: boolean }>(
  current: R[], input: (Partial<R> & { id?: string })[], build: (x: any, id: string, t: string) => R, t: string,
): R[] {
  const out: R[] = []
  const byId = new Map(current.map(r => [r.id, r]))
  const kept = new Set<string>()
  for (const x of input) {
    const prev = x.id ? byId.get(x.id) : undefined
    const id = prev ? prev.id : newId()
    kept.add(id)
    const next = build(x, id, t)
    if (!prev || !same({ ...prev, updatedAt: '' }, { ...next, updatedAt: '' })) out.push(next)
  }
  for (const r of current) if (!kept.has(r.id)) out.push({ ...r, deleted: true, updatedAt: t })
  return out
}

export function createTaurus(store: Store, opts: { onChange?: () => void } = {}) {
  let state: Snapshot | null = null
  const s = async () => (state ??= await store.load())

  async function put(changes: Partial<Snapshot>, silent = false) {
    upsert(await s(), changes)
    await store.save(changes)
    if (!silent) opts.onChange?.()
  }

  function dayView(st: Snapshot, date: string): DayRecord | null {
    const meta = st.days.find(d => d.id === date && !d.deleted)
    const services = live(st.services).filter(x => x.date === date)
    if (!meta && !services.length) return null
    const costs = meta?.costs ?? []
    const gross = services.reduce((t, x) => t + x.amount, 0)
    const totalCost = costs.reduce((t, c) => t + c.amount, 0)
    return {
      date, km: meta?.km ?? 0, note: meta?.note, costs, gross, totalCost, net: gross - totalCost,
      services: services.map(x => ({ id: x.id, amount: x.amount, method: x.method, note: x.note })),
    }
  }

  function cashView(st: Snapshot, date: string): CashDay | null {
    const m = st.cash.find(c => c.id === date && !c.deleted)
    if (!m) return null
    return {
      date, opening: m.opening, openedAt: m.openedAt, closedAt: m.closedAt, counted: m.counted,
      movements: live(st.movements).filter(x => x.date === date).map(x => ({ id: x.id, type: x.type, amount: x.amount, note: x.note })),
    }
  }

  const repo: Repo = {
    async listCategories(): Promise<Category[]> {
      return live((await s()).categories).map(c => ({ ...c }))
    },
    async saveCategory(c: NewCategory) {
      const st = await s()
      const prev = c.id ? st.categories.find(x => x.id === c.id) : undefined
      const rec: CategoryRec = { ...prev, ...c, id: c.id ?? newId(), updatedAt: now(), deleted: undefined } as CategoryRec
      delete rec.deleted
      await put({ categories: [rec] })
      return { ...rec }
    },
    async listDays(from, to) {
      const st = await s()
      const dates = new Set([...live(st.days).map(d => d.date), ...live(st.services).map(x => x.date)])
      return [...dates]
        .filter(d => (!from || d >= from) && (!to || d <= to))
        .sort((a, b) => b.localeCompare(a))
        .map(d => dayView(st, d)!)
    },
    async getDay(date) {
      return dayView(await s(), date)
    },
    async deleteDay(date) {
      const st = await s()
      const t = now()
      const days = st.days.filter(d => d.id === date && !d.deleted).map(d => ({ ...d, deleted: true, updatedAt: t }))
      const services = live(st.services).filter(x => x.date === date).map(x => ({ ...x, deleted: true, updatedAt: t }))
      await put({ days, services })
    },
    async getCash(date) {
      return cashView(await s(), date)
    },
    async listCash() {
      const st = await s()
      return live(st.cash).map(c => cashView(st, c.date)!).sort((a, b) => a.date.localeCompare(b.date))
    },
    async putCash(c: CashDay) {
      const st = await s()
      const t = now()
      const meta: CashMeta = {
        id: c.date, date: c.date, opening: c.opening, openedAt: c.openedAt, closedAt: c.closedAt, counted: c.counted, updatedAt: t,
      }
      const movements = diffChildren<MovementRec>(
        live(st.movements).filter(x => x.date === c.date),
        c.movements.map(m => ({ ...m, id: m.id || undefined })),
        (x, id, ts) => ({ id, date: c.date, type: x.type, amount: x.amount, note: x.note, updatedAt: ts }),
        t,
      )
      await put({ cash: [meta], movements })
    },
  }

  return {
    repo,

    /** Siembra Gasolina y Servicio (ids fijos, fecha mínima) si no hay categorías. */
    async init() {
      const st = await s()
      if (st.categories.length === 0) await put({ categories: structuredClone(SEED) }, true)
    },

    /** Guarda el día congelando las tarifas de las categorías activas ahora. */
    async saveDay(input: DayInput): Promise<DayRecord> {
      const st = await s()
      const t = now()
      const categories = live(st.categories)
      const { costs } = computeDay({ services: input.services.map(x => x.amount), km: input.km, categories })
      const prev = st.days.find(d => d.id === input.date && !d.deleted)
      const meta: DayMeta = { id: input.date, date: input.date, km: input.km, note: input.note, costs, updatedAt: t }
      const changedMeta = !prev || !same({ ...prev, updatedAt: '' }, { ...meta, updatedAt: '' })
      const services = diffChildren<ServiceRec>(
        live(st.services).filter(x => x.date === input.date),
        input.services,
        (x, id, ts) => ({ id, date: input.date, amount: x.amount, method: x.method ?? 'cash', note: x.note, updatedAt: ts }),
        t,
      )
      await put({ days: changedMeta ? [meta] : [], services })
      return dayView(st, input.date)!
    },

    /** Recalcula un día ya guardado con las tarifas actuales. */
    async recalcDay(date: string): Promise<DayRecord | null> {
      const day = dayView(await s(), date)
      if (!day) return null
      return this.saveDay({ date, km: day.km, note: day.note, services: day.services })
    },

    /** Estado completo, con lápidas (para sincronizar). */
    async snapshot(): Promise<Snapshot> {
      return structuredClone(await s())
    },

    /** Aplica registros que vienen de otro dispositivo (sin disparar otra subida). */
    async apply(changes: Partial<Snapshot>) {
      await put(changes, true)
    },
  }
}

export type Taurus = ReturnType<typeof createTaurus>
