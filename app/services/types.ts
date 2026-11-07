import type { Category, CostLine } from '../utils/calc'
import type { CommissionRates } from '../utils/commission'

export type PayMethod = 'cash' | 'transfer'
export type MovementType = 'expense' | 'withdrawal' | 'deposit'

/* ───────── Registros sincronizables ─────────
 * Todo registro tiene un id único, la fecha de su última edición y una marca de borrado
 * (lápida). La fusión entre dispositivos usa id + updatedAt; las lápidas propagan los borrados.
 * Días y cajas usan la fecha como id (uno por día en todos los dispositivos);
 * servicios, movimientos y categorías usan UUID.
 */
export interface Meta {
  id: string
  updatedAt: string // ISO
  deleted?: boolean
}

export interface DayMeta extends Meta {
  date: string // = id
  km: number
  note?: string
  /** Snapshot de tarifas aplicado al guardar el día. */
  costs: CostLine[]
}

export interface ServiceRec extends Meta {
  date: string
  amount: number
  /** Propina u otro extra (≥ 0); ausente = 0. */
  bonus?: number
  method: PayMethod
  note?: string
  /** Datos de viaje (HH:MM / km); ausentes en servicios anteriores. */
  startTime?: string
  endTime?: string
  distanceKm?: number
  origin?: string
  destination?: string
  /** Viaje inDrive (cobra comisión); ausente = true. */
  isIndrive?: boolean
  /** Comisión e IVA calculados al guardar el viaje (≥ 0). */
  commission?: number
  commissionVat?: number
}

export interface CashMeta extends Meta {
  date: string // = id
  opening: number
  openedAt: string
  closedAt?: string
  counted?: number
  /** Efectivo que va al depósito al cerrar (≥ 0, ≤ contado o esperado). */
  toDeposit?: number
}

export interface MovementRec extends Meta {
  date: string
  type: MovementType
  amount: number
  note?: string
}

/** Salida del depósito (fuera de la caja diaria). */
export interface DepositMovementRec extends Meta {
  date: string
  amount: number
  note?: string
}

export type CategoryRec = Category & Meta

/** Ajustes de la app; hoy un solo registro `rates` con las tasas de comisión inDrive (fracciones 0..1). */
export interface SettingsRec extends Meta {
  commissionRate: number
  vatRate: number
}

/** Estado completo (incluye lápidas). Es lo que se guarda y se espeja en Google Sheets. */
export interface Snapshot {
  categories: CategoryRec[]
  days: DayMeta[]
  services: ServiceRec[]
  cash: CashMeta[]
  movements: MovementRec[]
  depositMovements: DepositMovementRec[]
  settings: SettingsRec[]
}

export type Collection = keyof Snapshot

export const emptySnapshot = (): Snapshot => ({ categories: [], days: [], services: [], cash: [], movements: [], depositMovements: [], settings: [] })

/** Persistencia: carga todo y guarda registros por id (upsert). */
export interface Store {
  load(): Promise<Snapshot>
  save(changes: Partial<Snapshot>): Promise<void>
}

/* ───────── Vistas de dominio (lo que usa la UI) ───────── */

export interface Service {
  id?: string
  amount: number
  /** Propina u otro extra (≥ 0); ausente = 0. */
  bonus?: number
  note?: string
  /** Ausente = efectivo (InDrive paga mayormente en efectivo). */
  method?: PayMethod
  /** Datos de viaje (HH:MM / km); ausentes en servicios anteriores. */
  startTime?: string
  endTime?: string
  distanceKm?: number
  origin?: string
  destination?: string
  /** Viaje inDrive (cobra comisión); ausente = true. */
  isIndrive?: boolean
  /** Comisión e IVA calculados al guardar el viaje (≥ 0). */
  commission?: number
  commissionVat?: number
}

export interface CashMovement {
  id: string
  type: MovementType
  amount: number
  note?: string
}

/** Caja de un día: apertura, movimientos en efectivo y cierre. */
export interface CashDay {
  date: string // YYYY-MM-DD
  opening: number
  openedAt: string
  closedAt?: string
  counted?: number
  /** Lo que se lleva al depósito en el cierre. */
  toDeposit?: number
  movements: CashMovement[]
}

/** Salida del depósito (vista de dominio). */
export interface DepositMovement {
  id: string
  date: string
  amount: number
  note?: string
}

/** Día con sus servicios vivos y el snapshot de costos aplicado al registrarlo. */
export interface DayRecord {
  date: string // YYYY-MM-DD
  km: number
  note?: string
  services: Service[]
  costs: CostLine[]
  gross: number
  totalCost: number
  /** Comisión inDrive del día e IVA de esa comisión (ya descontados del neto). */
  commission: number
  commissionVat: number
  net: number
}

export type NewCategory = Omit<Category, 'id' | 'updatedAt' | 'deleted'> & { id?: string }

export interface Repo {
  listCategories(): Promise<Category[]>
  saveCategory(category: NewCategory): Promise<Category>
  listDays(from?: string, to?: string): Promise<DayRecord[]>
  getDay(date: string): Promise<DayRecord | null>
  deleteDay(date: string): Promise<void>
  getCash(date: string): Promise<CashDay | null>
  listCash(): Promise<CashDay[]>
  /** Crea/reemplaza la caja del día (apertura, movimientos y cierre). */
  putCash(cash: CashDay): Promise<void>
  listDepositMovements(): Promise<DepositMovement[]>
  /** Crea (sin id) o edita una salida del depósito. */
  saveDepositMovement(movement: Omit<DepositMovement, 'id'> & { id?: string }): Promise<DepositMovement>
  deleteDepositMovement(id: string): Promise<void>
  /** Tasas de comisión inDrive vigentes (por defecto si nunca se guardaron). */
  getRates(): Promise<CommissionRates>
  saveRates(rates: CommissionRates): Promise<CommissionRates>
}
