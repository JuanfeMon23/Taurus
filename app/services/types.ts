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
  /** Turno del día (`shifts[].id`) al que pertenece el viaje; ausente = sin turno. */
  shiftId?: string
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
  /** Cuenta de origen (`accounts[].id`); ausente solo en datos viejos: entonces vale la cuenta de su medio de pago (`method`) o la caja. */
  accountId?: string
  /** Cuenta de destino; solo los tipos que `requiresDestination` (traslados) la llevan. */
  toAccountId?: string
  /** Solo lectura, datos anteriores a las cuentas: medio de pago del movimiento. Ya no se escribe. */
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

/** Cuenta con saldo propio (caja, transferencias, depósito…); `isCashBox` = es la caja física del ciclo diario. */
export interface Account extends CatalogEntry {
  initialBalance: number
  isCashBox: boolean
}

/** Medio de pago: lleva su dinero a una cuenta; `affectsCash` = esa cuenta es la caja (se deriva de la cuenta, no se edita). */
export interface PaymentMethod extends CatalogEntry {
  accountId: string
  affectsCash: boolean
}

/** Tipo de movimiento de caja o de fondo; `sign` = efecto sobre el saldo (+1 suma, −1 resta). */
export interface SignedEntry extends CatalogEntry {
  sign: 1 | -1
}

/** Tipo de movimiento de caja; `hasCategory` = el movimiento pide categoría de gasto y alimenta «Gastos varios». */
export interface MovementTypeEntry extends SignedEntry {
  hasCategory: boolean
  /** El movimiento pide cuenta de destino (traslado entre cuentas). */
  requiresDestination: boolean
}

export type ExpenseCategory = CatalogEntry

/** Modo de tarifa de una categoría; las marcas dicen qué campos usa: `usesRatePerKm` = valor por km, `usesCostInterval` = costo total cada X km. */
export interface RateMode extends CatalogEntry {
  usesRatePerKm: boolean
  usesCostInterval: boolean
}

export interface Catalogs {
  accounts: Account[]
  paymentMethods: PaymentMethod[]
  movementTypes: MovementTypeEntry[]
  fundMovementTypes: SignedEntry[]
  expenseCategories: ExpenseCategory[]
  rateModes: RateMode[]
}

export type CatalogKind = keyof Catalogs

export const emptyCatalogs = (): Catalogs => ({ accounts: [], paymentMethods: [], movementTypes: [], fundMovementTypes: [], expenseCategories: [], rateModes: [] })

export type AccountRec = Account & Meta
export type PaymentMethodRec = PaymentMethod & Meta
export type MovementTypeRec = MovementTypeEntry & Meta
export type FundMovementTypeRec = SignedEntry & Meta
export type ExpenseCategoryRec = ExpenseCategory & Meta
export type RateModeRec = RateMode & Meta

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
  fundMovements: FundMovementRec[]
  shifts: ShiftRec[]
  shiftTemplates: ShiftTemplateRec[]
  accounts: AccountRec[]
  paymentMethods: PaymentMethodRec[]
  movementTypes: MovementTypeRec[]
  fundMovementTypes: FundMovementTypeRec[]
  expenseCategories: ExpenseCategoryRec[]
  rateModes: RateModeRec[]
  settings: SettingsRec[]
}

export type Collection = keyof Snapshot

export const emptySnapshot = (): Snapshot => ({ categories: [], days: [], services: [], cash: [], movements: [], fundMovements: [], shifts: [],
  shiftTemplates: [], accounts: [], paymentMethods: [], movementTypes: [], fundMovementTypes: [], expenseCategories: [], rateModes: [], settings: [] })

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
  /** Turno del día (`shifts[].id`) al que pertenece el viaje; ausente = sin turno. */
  shiftId?: string
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
  /** Cuenta de origen; la vista siempre la trae resuelta (datos viejos: la de su medio de pago, o la caja). */
  accountId: string
  toAccountId?: string
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

/** Movimiento de cuenta con su fecha (vista plana de todos los movimientos vivos, con o sin caja del día). */
export interface DatedMovement extends CashMovement {
  date: string
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
  /** Todos los movimientos vivos (nuevo primero), con su cuenta ya resuelta. */
  listMovements(): Promise<DatedMovement[]>
  /** Deja lápida a un movimiento, tenga o no caja su fecha. */
  deleteMovement(id: string): Promise<void>
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
  /** Los seis catálogos completos (también inactivos), ordenados por `sortOrder` y nombre. */
  listCatalogs(): Promise<Catalogs>
  /** Crea (sin id) o edita una entrada de catálogo. */
  saveCatalogEntry<Kind extends CatalogKind>(kind: Kind, entry: NewCatalogEntry<Catalogs[Kind][number]>): Promise<Catalogs[Kind][number]>
  /** Borra (lápida) una entrada; falla con mensaje legible si algún registro la usa. */
  deleteCatalogEntry(kind: CatalogKind, id: string): Promise<void>
  /** Tasas de comisión inDrive vigentes (por defecto si nunca se guardaron). */
  getRates(): Promise<CommissionRates>
  saveRates(rates: CommissionRates): Promise<CommissionRates>
}
