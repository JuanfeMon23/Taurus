import { computeDay, type Category } from '../utils/calc'
import { DEFAULT_RATES, dayNet, sumCommission, type CommissionRates } from '../utils/commission'
import { tripTotal } from '../utils/trip'
import { EPOCH, newId, now } from './ids'
import { upsert } from './memoryStore'
import { same } from './merge'
import type {
  CashDay, CashMeta, CategoryRec, DayMeta, DayRecord, DepositMovement, DepositMovementRec, MovementRec, NewCategory, Repo, Service, ServiceRec, SettingsRec, Snapshot, Store,
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

/** Copia al destino los datos de viaje presentes (los servicios viejos no los tienen). */
function tripFields<T extends object>(target: T, from: Service): T {
  const out: any = target
  if (from.bonus) out.bonus = from.bonus
  if (from.startTime) out.startTime = from.startTime
  if (from.endTime) out.endTime = from.endTime
  if (from.distanceKm !== undefined && from.distanceKm !== null) out.distanceKm = from.distanceKm
  if (from.origin) out.origin = from.origin
  if (from.destination) out.destination = from.destination
  if (from.isIndrive !== undefined) out.isIndrive = from.isIndrive
  if (from.commission !== undefined) out.commission = from.commission
  if (from.commissionVat !== undefined) out.commissionVat = from.commissionVat
  return target
}

const RATES_ID = 'rates'

const live = <T extends { deleted?: boolean }>(items: T[]) => items.filter(item => !item.deleted)

/**
 * Sincroniza una lista hija (servicios de un día, movimientos de una caja):
 * conserva ids, actualiza solo lo que cambió y deja lápida de lo que se quitó.
 */
function diffChildren<R extends { id: string; updatedAt: string; deleted?: boolean }>(
  current: R[], input: (Partial<R> & { id?: string })[], build: (item: any, id: string, editedAt: string) => R, timestamp: string,
): R[] {
  const out: R[] = []
  const byId = new Map(current.map(record => [record.id, record]))
  const kept = new Set<string>()
  for (const item of input) {
    const previous = item.id ? byId.get(item.id) : undefined
    const id = previous ? previous.id : newId()
    kept.add(id)
    const next = build(item, id, timestamp)
    if (!previous || !same({ ...previous, updatedAt: '' }, { ...next, updatedAt: '' })) out.push(next)
  }
  for (const record of current) if (!kept.has(record.id)) out.push({ ...record, deleted: true, updatedAt: timestamp })
  return out
}

export function createTaurus(store: Store, opts: { onChange?: () => void } = {}) {
  let state: Snapshot | null = null
  const loadState = async () => (state ??= await store.load())

  async function put(changes: Partial<Snapshot>, silent = false) {
    upsert(await loadState(), changes)
    await store.save(changes)
    if (!silent) opts.onChange?.()
  }

  function dayView(snapshot: Snapshot, date: string): DayRecord | null {
    const meta = snapshot.days.find(day => day.id === date && !day.deleted)
    const services = live(snapshot.services).filter(service => service.date === date)
    if (!meta && !services.length) return null
    const costs = meta?.costs ?? []
    const gross = services.reduce((sum, service) => sum + tripTotal(service), 0)
    const totalCost = costs.reduce((sum, cost) => sum + cost.amount, 0)
    const { commission, commissionVat } = sumCommission(services)
    return {
      date, km: meta?.km ?? 0, note: meta?.note, costs, gross, totalCost, commission, commissionVat,
      net: dayNet(gross, totalCost, commission, commissionVat),
      services: services.map(service => tripFields({ id: service.id, amount: service.amount, method: service.method, note: service.note }, service)),
    }
  }

  function cashView(snapshot: Snapshot, date: string): CashDay | null {
    const cashMeta = snapshot.cash.find(cashRecord => cashRecord.id === date && !cashRecord.deleted)
    if (!cashMeta) return null
    return {
      date, opening: cashMeta.opening, openedAt: cashMeta.openedAt, closedAt: cashMeta.closedAt, counted: cashMeta.counted,
      ...(cashMeta.toDeposit !== undefined ? { toDeposit: cashMeta.toDeposit } : {}),
      movements: live(snapshot.movements).filter(movement => movement.date === date).map(movement => ({ id: movement.id, type: movement.type, amount: movement.amount, note: movement.note })),
    }
  }

  const repo: Repo = {
    async listCategories(): Promise<Category[]> {
      return live((await loadState()).categories).map(category => ({ ...category }))
    },
    async saveCategory(category: NewCategory) {
      const snapshot = await loadState()
      const previous = category.id ? snapshot.categories.find(existing => existing.id === category.id) : undefined
      const record: CategoryRec = { ...previous, ...category, id: category.id ?? newId(), updatedAt: now(), deleted: undefined } as CategoryRec
      delete record.deleted
      await put({ categories: [record] })
      return { ...record }
    },
    async listDays(from, to) {
      const snapshot = await loadState()
      const dates = new Set([...live(snapshot.days).map(day => day.date), ...live(snapshot.services).map(service => service.date)])
      return [...dates]
        .filter(date => (!from || date >= from) && (!to || date <= to))
        .sort((dateA, dateB) => dateB.localeCompare(dateA))
        .map(date => dayView(snapshot, date)!)
    },
    async getDay(date) {
      return dayView(await loadState(), date)
    },
    async deleteDay(date) {
      const snapshot = await loadState()
      const timestamp = now()
      const days = snapshot.days.filter(day => day.id === date && !day.deleted).map(day => ({ ...day, deleted: true, updatedAt: timestamp }))
      const services = live(snapshot.services).filter(service => service.date === date).map(service => ({ ...service, deleted: true, updatedAt: timestamp }))
      await put({ days, services })
    },
    async getCash(date) {
      return cashView(await loadState(), date)
    },
    async listCash() {
      const snapshot = await loadState()
      return live(snapshot.cash).map(cashRecord => cashView(snapshot, cashRecord.date)!).sort((cashA, cashB) => cashA.date.localeCompare(cashB.date))
    },
    async putCash(cashDay: CashDay) {
      const snapshot = await loadState()
      const timestamp = now()
      const meta: CashMeta = {
        id: cashDay.date, date: cashDay.date, opening: cashDay.opening, openedAt: cashDay.openedAt, closedAt: cashDay.closedAt, counted: cashDay.counted, updatedAt: timestamp,
      }
      if (cashDay.toDeposit !== undefined) meta.toDeposit = cashDay.toDeposit
      const movements = diffChildren<MovementRec>(
        live(snapshot.movements).filter(movement => movement.date === cashDay.date),
        cashDay.movements.map(movement => ({ ...movement, id: movement.id || undefined })),
        (item, id, editedAt) => ({ id, date: cashDay.date, type: item.type, amount: item.amount, note: item.note, updatedAt: editedAt }),
        timestamp,
      )
      await put({ cash: [meta], movements })
    },
    async listDepositMovements() {
      return live((await loadState()).depositMovements)
        .map(movement => ({ id: movement.id, date: movement.date, amount: movement.amount, note: movement.note }) as DepositMovement)
        .sort((movementA, movementB) => movementB.date.localeCompare(movementA.date))
    },
    async saveDepositMovement(movement) {
      const record: DepositMovementRec = { id: movement.id ?? newId(), date: movement.date, amount: movement.amount, note: movement.note || undefined, updatedAt: now() }
      await put({ depositMovements: [record] })
      return { id: record.id, date: record.date, amount: record.amount, note: record.note }
    },
    async getRates(): Promise<CommissionRates> {
      const record = live((await loadState()).settings).find(setting => setting.id === RATES_ID)
      return record ? { commissionRate: record.commissionRate, vatRate: record.vatRate } : { ...DEFAULT_RATES }
    },
    async saveRates(rates: CommissionRates) {
      const record: SettingsRec = { id: RATES_ID, commissionRate: rates.commissionRate, vatRate: rates.vatRate, updatedAt: now() }
      await put({ settings: [record] })
      return { commissionRate: record.commissionRate, vatRate: record.vatRate }
    },
    async deleteDepositMovement(id) {
      const previous = (await loadState()).depositMovements.find(movement => movement.id === id && !movement.deleted)
      if (previous) await put({ depositMovements: [{ ...previous, deleted: true, updatedAt: now() }] })
    },
  }

  return {
    repo,

    /** Siembra Gasolina y Servicio (ids fijos, fecha mínima) si no hay categorías. */
    async init() {
      const snapshot = await loadState()
      if (snapshot.categories.length === 0) await put({ categories: structuredClone(SEED) }, true)
    },

    /** Guarda el día congelando las tarifas de las categorías activas ahora. */
    async saveDay(input: DayInput): Promise<DayRecord> {
      const snapshot = await loadState()
      const timestamp = now()
      const categories = live(snapshot.categories)
      const { costs } = computeDay({ services: input.services.map(tripTotal), km: input.km, categories })
      const previous = snapshot.days.find(day => day.id === input.date && !day.deleted)
      const meta: DayMeta = { id: input.date, date: input.date, km: input.km, note: input.note, costs, updatedAt: timestamp }
      const changedMeta = !previous || !same({ ...previous, updatedAt: '' }, { ...meta, updatedAt: '' })
      const services = diffChildren<ServiceRec>(
        live(snapshot.services).filter(service => service.date === input.date),
        input.services,
        (item, id, editedAt) => tripFields({ id, date: input.date, amount: item.amount, method: item.method ?? 'cash', note: item.note, updatedAt: editedAt }, item),
        timestamp,
      )
      await put({ days: changedMeta ? [meta] : [], services })
      return dayView(snapshot, input.date)!
    },

    /** Recalcula un día ya guardado con las tarifas actuales. */
    async recalcDay(date: string): Promise<DayRecord | null> {
      const day = dayView(await loadState(), date)
      if (!day) return null
      return this.saveDay({ date, km: day.km, note: day.note, services: day.services })
    },

    /** Estado completo, con lápidas (para sincronizar). */
    async snapshot(): Promise<Snapshot> {
      return structuredClone(await loadState())
    },

    /** Aplica registros que vienen de otro dispositivo (sin disparar otra subida). */
    async apply(changes: Partial<Snapshot>) {
      await put(changes, true)
    },
  }
}

export type Taurus = ReturnType<typeof createTaurus>
