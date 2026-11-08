import type { Category, CostLine } from '../utils/calc'
import type { CommissionRates } from '../utils/commission'

/** Códigos de catálogo (id de la entrada en `paymentMethods`, `movementTypes`, `fundMovementTypes`); el catálogo vive en BD. */
export type PayMethod = string
export type MovementType = string
export type FundMovementType = string

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
  /** Categoría del gasto varios: id de `expenseCategories`. */
  categoryId?: string
  /** Medio de pago; ausente = el medio por defecto del catálogo. Los que no afectan la caja no la tocan. */
  method?: PayMethod
}

/** Envío al fondo de una categoría de costo, o gasto hecho con ese fondo. */
export interface FundMovementRec extends Meta {
  date: string
  categoryId: string
  type: FundMovementType
  amount: number
  note?: string
}

/** Salida del depósito (fuera de la caja diaria). */
export interface DepositMovementRec extends Meta {
  date: string
  amount: number
  note?: string
}

/** Turno de trabajo del día (franja HH:MM; `endTime` ausente = turno en curso). */
export interface ShiftRec extends Meta {
  date: string
  startTime: string
  endTime?: string
  note?: string
  /** Plantilla de turno con la que se creó; ausente = turno suelto. */
  templateId?: string
}

/** Turno habitual que se aplica cada día (nombre y franja HH:MM). */
export interface ShiftTemplate {
  id: string
  name: string
  startTime: string
  endTime: string
  sortOrder: number
  active: boolean
}

export type NewShiftTemplate = Omit<ShiftTemplate, 'id' | 'sortOrder' | 'active'> & { id?: string; sortOrder?: number; active?: boolean }

export type ShiftTemplateRec = ShiftTemplate & Meta

/* ───────── Catálogos (listas seleccionables; viven en BD, nunca en el código) ───────── */

export interface CatalogEntry {
  /** Código estable que guardan los registros que lo usan (sin llave foránea). */
  id: string
  name: string
  sortOrder: number
  active: boolean
}

/** Medio de pago; `affectsCash` = el dinero entra o sale de la caja física. */
export interface PaymentMethod extends CatalogEntry {
  affectsCash: boolean
}

/** Tipo de movimiento de caja o de fondo; `sign` = efecto sobre el saldo (+1 suma, −1 resta). */
export interface SignedEntry extends CatalogEntry {
  sign: 1 | -1
}

export type ExpenseCategory = CatalogEntry

export interface Catalogs {
  paymentMethods: PaymentMethod[]
  movementTypes: SignedEntry[]
  fundMovementTypes: SignedEntry[]
  expenseCategories: ExpenseCategory[]
}

export type CatalogKind = keyof Catalogs

export const emptyCatalogs = (): Catalogs => ({ paymentMethods: [], movementTypes: [], fundMovementTypes: [], expenseCategories: [] })

export type PaymentMethodRec = PaymentMethod & Meta
export type MovementTypeRec = SignedEntry & Meta
export type FundMovementTypeRec = SignedEntry & Meta
export type ExpenseCategoryRec = ExpenseCategory & Meta

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
  fundMovements: FundMovementRec[]
  shifts: ShiftRec[]
  shiftTemplates: ShiftTemplateRec[]
  paymentMethods: PaymentMethodRec[]
  movementTypes: MovementTypeRec[]
  fundMovementTypes: FundMovementTypeRec[]
  expenseCategories: ExpenseCategoryRec[]
  settings: SettingsRec[]
}

export type Collection = keyof Snapshot

export const emptySnapshot = (): Snapshot => ({ categories: [], days: [], services: [], cash: [], movements: [], depositMovements: [], fundMovements: [], shifts: [],
  shiftTemplates: [], paymentMethods: [], movementTypes: [], fundMovementTypes: [], expenseCategories: [], settings: [] })

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
  categoryId?: string
  method?: PayMethod
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

/** Movimiento de un fondo (vista de dominio). */
export interface FundMovement {
  id: string
  date: string
  categoryId: string
  type: FundMovementType
  amount: number
  note?: string
}

/** Turno de trabajo (vista de dominio). */
export interface Shift {
  id: string
  date: string
  startTime: string
  /** Ausente = turno en curso. */
  endTime?: string
  note?: string
  /** Plantilla con la que se creó; ausente = turno suelto. */
  templateId?: string
}

export type NewShift = Omit<Shift, 'id'> & { id?: string }

/** Día con sus servicios vivos y el snapshot de costos aplicado al registrarlo. */
export interface DayRecord {
  date: string // YYYY-MM-DD
  km: number
  note?: string
  services: Service[]
  /** Turnos vivos del día (vacío si no hay). */
  shifts?: Shift[]
  costs: CostLine[]
  gross: number
  totalCost: number
  /** Comisión inDrive del día e IVA de esa comisión (ya descontados del neto). */
  commission: number
  commissionVat: number
  net: number
}

/** Entrada de catálogo por crear: sin id se genera a partir del nombre; orden y activo tienen valor por defecto. */
export type NewCatalogEntry<Entry extends CatalogEntry> = Omit<Entry, 'id' | 'sortOrder' | 'active'> & { id?: string; sortOrder?: number; active?: boolean }

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
  listFundMovements(): Promise<FundMovement[]>
  /** Crea (sin id) o edita un movimiento de fondo. */
  saveFundMovement(movement: Omit<FundMovement, 'id'> & { id?: string }): Promise<FundMovement>
  deleteFundMovement(id: string): Promise<void>
  listShifts(date: string): Promise<Shift[]>
  /** Crea (sin id) o edita un turno. */
  saveShift(shift: NewShift): Promise<Shift>
  deleteShift(id: string): Promise<void>
  /** Plantillas de turno ordenadas; por defecto solo las activas. */
  listShiftTemplates(options?: { includeInactive?: boolean }): Promise<ShiftTemplate[]>
  saveShiftTemplate(template: NewShiftTemplate): Promise<ShiftTemplate>
  /** Deja lápida a la plantilla (los turnos ya creados con ella se conservan). */
  deleteShiftTemplate(id: string): Promise<void>
  /** Los cuatro catálogos completos (también inactivos), ordenados por `sortOrder` y nombre. */
  listCatalogs(): Promise<Catalogs>
  /** Crea (sin id) o edita una entrada de catálogo. */
  saveCatalogEntry<Kind extends CatalogKind>(kind: Kind, entry: NewCatalogEntry<Catalogs[Kind][number]>): Promise<Catalogs[Kind][number]>
  /** Borra (lápida) una entrada; falla con mensaje legible si algún registro la usa. */
  deleteCatalogEntry(kind: CatalogKind, id: string): Promise<void>
  /** Tasas de comisión inDrive vigentes (por defecto si nunca se guardaron). */
  getRates(): Promise<CommissionRates>
  saveRates(rates: CommissionRates): Promise<CommissionRates>
}
