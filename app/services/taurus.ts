import { computeDay, type Category } from '../utils/calc'
import { DEPOSIT_ACCOUNT_ID } from '../utils/accounts'
import { catalogEntryInUse, defaultMethodId, movementAccountId, movementTypeRequiresDestination, slugifyCode, sortCatalog, withReferencedCatalogs } from '../utils/catalogs'
import { DEFAULT_RATES, dayNet, sumCommission, type CommissionRates } from '../utils/commission'
import { tripTotal } from '../utils/trip'
import { sortShiftTemplates } from '../utils/shifts'
import { ApiError } from './apiStore'
import { SEED_CATALOGS } from './catalogSeeds'
import { EPOCH, newId, now } from './ids'
import { upsert } from './memoryStore'
import { same } from './merge'
import type {
  AccountRec, CashDay, CashMeta, CashMovement, CatalogEntry, CatalogKind, Catalogs, CategoryRec, DatedMovement, DayMeta, DayRecord, FundMovement, FundMovementRec, Meta, MovementRec, NewCategory, Repo, Service, ServiceRec, SettingsRec, Shift, ShiftRec,
  ShiftTemplate, ShiftTemplateRec, Snapshot, Store,
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
  if (from.shiftId) out.shiftId = from.shiftId
  if (from.isIndrive !== undefined) out.isIndrive = from.isIndrive
  if (from.commission !== undefined) out.commission = from.commission
  if (from.commissionVat !== undefined) out.commissionVat = from.commissionVat
  return target
}

const shiftView = (shift: ShiftRec): Shift => ({
  id: shift.id, date: shift.date, startTime: shift.startTime,
  ...(shift.endTime ? { endTime: shift.endTime } : {}), ...(shift.note ? { note: shift.note } : {}), ...(shift.templateId ? { templateId: shift.templateId } : {}),
})

const shiftsOf = (snapshot: Snapshot, date: string): Shift[] =>
  live(snapshot.shifts).filter(shift => shift.date === date).sort((first, second) => first.startTime.localeCompare(second.startTime)).map(shiftView)

const RATES_ID = 'rates'

const live = <T extends { deleted?: boolean }>(items: T[]) => items.filter(item => !item.deleted)

/** Quita los campos de sincronización y deja la vista de dominio. */
const withoutMeta = <T extends Meta>({ updatedAt: _updatedAt, deleted: _deleted, ...view }: T): Omit<T, 'updatedAt' | 'deleted'> => view

const nextSortOrder = (entries: { sortOrder: number }[]) => entries.reduce((highest, entry) => Math.max(highest, entry.sortOrder + 1), 0)

const CATALOG_KINDS: CatalogKind[] = ['accounts', 'paymentMethods', 'movementTypes', 'fundMovementTypes', 'expenseCategories', 'rateModes']

/** Medio de pago de un registro: el suyo o, si no trae, el primero activo del catálogo. */
const methodOrDefault = (snapshot: Snapshot, method: string | undefined): string | undefined => method ?? defaultMethodId(live(snapshot.paymentMethods))

/** Cuenta de origen de un movimiento: la suya o, en datos viejos, la de su medio de pago (o la caja). */
const accountOf = (snapshot: Snapshot, movement: { accountId?: string; method?: string }): string | undefined =>
  movementAccountId(movement, { accounts: live(snapshot.accounts), paymentMethods: live(snapshot.paymentMethods) })

const movementView = (snapshot: Snapshot, movement: MovementRec): CashMovement => ({
  id: movement.id, type: movement.type, amount: movement.amount, note: movement.note,
  ...(movement.categoryId ? { categoryId: movement.categoryId } : {}), accountId: accountOf(snapshot, movement) ?? '',
  ...(movement.toAccountId ? { toAccountId: movement.toAccountId } : {}),
})

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
    const current = await loadState()
    upsert(current, changes)
    // Los catálogos que usan los registros viajan en el mismo PUT: el backend rechaza un código que aún no conoce.
    await store.save(withReferencedCatalogs(current, changes))
    if (!silent) opts.onChange?.()
  }

  /**
   * Almacén local anterior a las cuentas: siembra las cuentas y el tipo traslado, asigna cuenta a cada medio de pago
   * (la caja si afecta la caja; si no, transferencias) y vuelve movimientos de la cuenta depósito las salidas viejas del depósito.
   */
  async function migrateToAccounts(snapshot: Snapshot) {
    const timestamp = now()
    const methods = live(snapshot.paymentMethods).filter(method => !method.accountId)
      .map(method => ({ ...method, accountId: method.affectsCash ? 'caja' : 'transferencias', updatedAt: timestamp }))
    const knownIds = new Set(snapshot.movements.map(movement => movement.id))
    const oldOutflows = (snapshot as unknown as { depositMovements?: { id: string; date: string; amount: number; note?: string; deleted?: boolean }[] }).depositMovements ?? []
    const movements: MovementRec[] = oldOutflows.filter(outflow => !outflow.deleted && !knownIds.has(outflow.id))
      .map(outflow => ({ id: outflow.id, date: outflow.date, type: 'withdrawal', amount: outflow.amount, note: outflow.note, accountId: DEPOSIT_ACCOUNT_ID, updatedAt: timestamp }))
    const transferType = snapshot.movementTypes.some(type => type.id === 'traslado') ? [] : SEED_CATALOGS.movementTypes.filter(type => type.requiresDestination)
    await put({ accounts: structuredClone(SEED_CATALOGS.accounts), paymentMethods: methods, movementTypes: structuredClone(transferType), movements }, true)
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
      date, km: meta?.km ?? 0, note: meta?.note, shifts: shiftsOf(snapshot, date), costs, gross, totalCost, commission, commissionVat,
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
      movements: live(snapshot.movements).filter(movement => movement.date === date).map(movement => movementView(snapshot, movement)),
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
      const shifts = live(snapshot.shifts).filter(shift => shift.date === date).map(shift => ({ ...shift, deleted: true, updatedAt: timestamp }))
      await put({ days, services, shifts })
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
        (item, id, editedAt) => ({
          id, date: cashDay.date, type: item.type, amount: item.amount, note: item.note,
          ...(item.categoryId ? { categoryId: item.categoryId } : {}), accountId: item.accountId ?? accountOf(snapshot, item),
          ...(item.toAccountId && movementTypeRequiresDestination(live(snapshot.movementTypes), item.type) ? { toAccountId: item.toAccountId } : {}), updatedAt: editedAt,
        }),
        timestamp,
      )
      await put({ cash: [meta], movements })
    },
    async listMovements(): Promise<DatedMovement[]> {
      const snapshot = await loadState()
      return live(snapshot.movements)
        .map(movement => ({ ...movementView(snapshot, movement), date: movement.date }))
        .sort((movementA, movementB) => movementB.date.localeCompare(movementA.date))
    },
    async deleteMovement(id) {
      const previous = (await loadState()).movements.find(movement => movement.id === id && !movement.deleted)
      if (previous) await put({ movements: [{ ...previous, deleted: true, updatedAt: now() }] })
    },
    async listFundMovements() {
      return live((await loadState()).fundMovements)
        .map(movement => ({ id: movement.id, date: movement.date, categoryId: movement.categoryId, type: movement.type, amount: movement.amount, note: movement.note }) as FundMovement)
        .sort((movementA, movementB) => movementB.date.localeCompare(movementA.date))
    },
    async saveFundMovement(movement) {
      const record: FundMovementRec = {
        id: movement.id ?? newId(), date: movement.date, categoryId: movement.categoryId, type: movement.type, amount: movement.amount,
        note: movement.note || undefined, updatedAt: now(),
      }
      await put({ fundMovements: [record] })
      return { id: record.id, date: record.date, categoryId: record.categoryId, type: record.type, amount: record.amount, note: record.note }
    },
    async deleteFundMovement(id) {
      const previous = (await loadState()).fundMovements.find(movement => movement.id === id && !movement.deleted)
      if (previous) await put({ fundMovements: [{ ...previous, deleted: true, updatedAt: now() }] })
    },
    async listShifts(date) {
      return shiftsOf(await loadState(), date)
    },
    async saveShift(shift) {
      const record: ShiftRec = {
        id: shift.id ?? newId(), date: shift.date, startTime: shift.startTime,
        ...(shift.endTime ? { endTime: shift.endTime } : {}), ...(shift.note ? { note: shift.note } : {}), ...(shift.templateId ? { templateId: shift.templateId } : {}),
        updatedAt: now(),
      }
      await put({ shifts: [record] })
      return shiftView(record)
    },
    async deleteShift(id) {
      const previous = (await loadState()).shifts.find(shift => shift.id === id && !shift.deleted)
      if (previous) await put({ shifts: [{ ...previous, deleted: true, updatedAt: now() }] })
    },
    async listShiftTemplates(options = {}) {
      const templates = live((await loadState()).shiftTemplates).map(withoutMeta) as ShiftTemplate[]
      return sortShiftTemplates(options.includeInactive ? templates : templates.filter(template => template.active))
    },
    async saveShiftTemplate(template) {
      const snapshot = await loadState()
      const previous = template.id ? snapshot.shiftTemplates.find(existing => existing.id === template.id) : undefined
      const record: ShiftTemplateRec = {
        id: template.id ?? newId(), name: template.name.trim(), startTime: template.startTime, endTime: template.endTime,
        sortOrder: template.sortOrder ?? previous?.sortOrder ?? nextSortOrder(live(snapshot.shiftTemplates)),
        active: template.active ?? previous?.active ?? true, updatedAt: now(),
      }
      await put({ shiftTemplates: [record] })
      return withoutMeta(record)
    },
    async deleteShiftTemplate(id) {
      const previous = (await loadState()).shiftTemplates.find(template => template.id === id && !template.deleted)
      if (previous) await put({ shiftTemplates: [{ ...previous, deleted: true, updatedAt: now() }] })
    },
    async listCatalogs(): Promise<Catalogs> {
      const snapshot = await loadState()
      return Object.fromEntries(CATALOG_KINDS.map(kind => [kind, sortCatalog(live(snapshot[kind] as (CatalogEntry & Meta)[]).map(withoutMeta))])) as unknown as Catalogs
    },
    async saveCatalogEntry(kind, entry) {
      const snapshot = await loadState()
      const entries = snapshot[kind] as (CatalogEntry & Meta)[]
      const id = entry.id ?? slugifyCode(entry.name)
      if (!id) throw new ApiError('El nombre debe tener letras o números.')
      const previous = entries.find(existing => existing.id === id)
      if (!entry.id && previous && !previous.deleted) throw new ApiError('Ya existe una opción con ese nombre.')
      const revived = previous?.deleted ? undefined : previous
      const record = {
        ...revived, ...entry, id, name: entry.name.trim(),
        sortOrder: entry.sortOrder ?? revived?.sortOrder ?? nextSortOrder(live(entries)),
        active: entry.active ?? revived?.active ?? true, updatedAt: now(),
      } as CatalogEntry & Meta & Record<string, unknown>
      if (kind === 'paymentMethods') {
        const account = live(snapshot.accounts).find(candidate => candidate.id === record.accountId)
        if (!account) throw new ApiError('Elige la cuenta del medio de pago.')
        record.affectsCash = account.isCashBox // se deriva de la cuenta, no se edita
      } else if (kind === 'accounts') {
        record.initialBalance ??= 0
        record.isCashBox ??= false
      } else if (kind === 'movementTypes') record.requiresDestination ??= false
      await put({ [kind]: [record] })
      return withoutMeta(record) as never
    },
    async deleteCatalogEntry(kind, id) {
      const snapshot = await loadState()
      if (catalogEntryInUse(snapshot, kind, id)) throw new ApiError('No se puede borrar: está en uso. Desactívala para dejar de ofrecerla.')
      const previous = (snapshot[kind] as (CatalogEntry & Meta)[]).find(entry => entry.id === id && !entry.deleted)
      if (previous) await put({ [kind]: [{ ...previous, deleted: true, updatedAt: now() }] })
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
  }

  return {
    repo,

    /** Siembra Gasolina y Servicio (ids fijos, fecha mínima) si no hay categorías. */
    async init() {
      const snapshot = await loadState()
      if (snapshot.categories.length === 0) await put({ categories: structuredClone(SEED) }, true)
      // Solo un almacén local nuevo: con el backend los catálogos ya vienen sembrados desde la BD.
      if (CATALOG_KINDS.every(kind => snapshot[kind].length === 0)) await put(structuredClone(SEED_CATALOGS), true)
      else {
        if (snapshot.rateModes.length === 0) await put({ rateModes: structuredClone(SEED_CATALOGS.rateModes) }, true)
        if (snapshot.accounts.length === 0) await migrateToAccounts(snapshot)
      }
    },

    /** Guarda el día congelando las tarifas de las categorías activas ahora. */
    async saveDay(input: DayInput): Promise<DayRecord> {
      const snapshot = await loadState()
      const timestamp = now()
      const categories = live(snapshot.categories)
      const serviceMethod = (method: string | undefined): string => {
        const resolved = methodOrDefault(snapshot, method)
        if (!resolved) throw new ApiError('No hay medios de pago; agrega uno en Tarifas > Catálogos.')
        return resolved
      }
      const { costs } = computeDay({ services: input.services.map(tripTotal), km: input.km, categories, rateModes: live(snapshot.rateModes) })
      const previous = snapshot.days.find(day => day.id === input.date && !day.deleted)
      const meta: DayMeta = { id: input.date, date: input.date, km: input.km, note: input.note, costs, updatedAt: timestamp }
      const changedMeta = !previous || !same({ ...previous, updatedAt: '' }, { ...meta, updatedAt: '' })
      const services = diffChildren<ServiceRec>(
        live(snapshot.services).filter(service => service.date === input.date),
        input.services,
        (item, id, editedAt) => tripFields({ id, date: input.date, amount: item.amount, method: serviceMethod(item.method), note: item.note, updatedAt: editedAt }, item),
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
