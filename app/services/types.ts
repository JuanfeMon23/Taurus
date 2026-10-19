import type { Category, CostLine } from '../utils/calc'

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
  method: PayMethod
  note?: string
}

export interface CashMeta extends Meta {
  date: string // = id
  opening: number
  openedAt: string
  closedAt?: string
  counted?: number
}

export interface MovementRec extends Meta {
  date: string
  type: MovementType
  amount: number
  note?: string
}

export type CategoryRec = Category & Meta

/** Estado completo (incluye lápidas). Es lo que se guarda y se espeja en Google Sheets. */
export interface Snapshot {
  categories: CategoryRec[]
  days: DayMeta[]
  services: ServiceRec[]
  cash: CashMeta[]
  movements: MovementRec[]
}

export type Collection = keyof Snapshot

export const emptySnapshot = (): Snapshot => ({ categories: [], days: [], services: [], cash: [], movements: [] })

/** Persistencia: carga todo y guarda registros por id (upsert). */
export interface Store {
  load(): Promise<Snapshot>
  save(changes: Partial<Snapshot>): Promise<void>
}

/* ───────── Vistas de dominio (lo que usa la UI) ───────── */

export interface Service {
  id?: string
  amount: number
  note?: string
  /** Ausente = efectivo (InDrive paga mayormente en efectivo). */
  method?: PayMethod
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
  movements: CashMovement[]
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
  net: number
}

export type NewCategory = Omit<Category, 'id' | 'updatedAt' | 'deleted'> & { id?: string }

export interface Repo {
  listCategories(): Promise<Category[]>
  saveCategory(c: NewCategory): Promise<Category>
  listDays(from?: string, to?: string): Promise<DayRecord[]>
  getDay(date: string): Promise<DayRecord | null>
  deleteDay(date: string): Promise<void>
  getCash(date: string): Promise<CashDay | null>
  listCash(): Promise<CashDay[]>
  /** Crea/reemplaza la caja del día (apertura, movimientos y cierre). */
  putCash(cash: CashDay): Promise<void>
}
