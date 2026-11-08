import type { CostLine } from '../../utils/calc'
import { emptySnapshot, type Snapshot } from '../types'

export type Cell = string | number
export type SheetRows = Cell[][]

/** Hojas del espejo, con sus encabezados (primera fila). Toda fila lleva id único, fecha de edición y lápida. */
export const SHEETS = [
  { title: 'Categorias', headers: ['id', 'nombre', 'modo', 'valor_km', 'costo_total', 'cada_km', 'activa', 'actualizado', 'borrado'] },
  { title: 'Dias', headers: ['id', 'km', 'nota', 'bruto', 'costos', 'neto', 'detalle_costos', 'actualizado', 'borrado'] },
  { title: 'Servicios', headers: ['id', 'fecha', 'monto', 'metodo', 'nota', 'actualizado', 'borrado'] },
  { title: 'Caja', headers: ['id', 'apertura', 'abierta_en', 'cerrada_en', 'contado', 'actualizado', 'borrado'] },
  { title: 'Movimientos', headers: ['id', 'fecha', 'tipo', 'monto', 'nota', 'actualizado', 'borrado'] },
] as const

const cellOrEmpty = (value: unknown): Cell => (value === undefined || value === null ? '' : (value as Cell))
const deletedFlag = (isDeleted?: boolean): Cell => (isDeleted ? 1 : '')

export function toSheets(snapshot: Snapshot): Record<string, SheetRows> {
  const out: Record<string, SheetRows> = Object.fromEntries(SHEETS.map(sheet => [sheet.title, [[...sheet.headers]]]))

  for (const category of snapshot.categories) {
    out.Categorias!.push([category.id, category.name, category.rateMode, cellOrEmpty(category.ratePerKm), cellOrEmpty(category.totalCost), cellOrEmpty(category.intervalKm), category.active ? 1 : 0, category.updatedAt, deletedFlag(category.deleted)])
  }
  for (const day of snapshot.days) {
    // bruto/costos/neto son informativos para quien abre la hoja; al importar se recalculan.
    const gross = snapshot.services.filter(service => service.date === day.date && !service.deleted).reduce((sum, service) => sum + service.amount, 0)
    const cost = day.costs.reduce((sum, costLine) => sum + costLine.amount, 0)
    out.Dias!.push([day.id, day.km, cellOrEmpty(day.note), gross, cost, gross - cost, JSON.stringify(day.costs), day.updatedAt, deletedFlag(day.deleted)])
  }
  for (const service of snapshot.services) out.Servicios!.push([service.id, service.date, service.amount, service.method, cellOrEmpty(service.note), service.updatedAt, deletedFlag(service.deleted)])
  for (const cashDay of snapshot.cash) out.Caja!.push([cashDay.id, cashDay.opening, cashDay.openedAt, cellOrEmpty(cashDay.closedAt), cellOrEmpty(cashDay.counted), cashDay.updatedAt, deletedFlag(cashDay.deleted)])
  for (const movement of snapshot.movements) out.Movimientos!.push([movement.id, movement.date, movement.type, movement.amount, cellOrEmpty(movement.note), movement.updatedAt, deletedFlag(movement.deleted)])
  return out
}

const str = (value: unknown) => (value === '' || value == null ? undefined : String(value))
const num = (value: unknown) => {
  if (value === '' || value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const isDel = (value: unknown) => value === 1 || value === '1' || value === true || value === 'TRUE'

/** Filas válidas: con id y fecha de edición (lo demás se ignora). */
function body(rows: SheetRows | undefined, updatedCol: number) {
  return (rows ?? []).slice(1).filter(row => str(row[0]) && str(row[updatedCol]))
}
function meta(row: Cell[], updatedCol: number) {
  const result: { id: string; updatedAt: string; deleted?: boolean } = { id: String(row[0]), updatedAt: String(row[updatedCol]) }
  if (isDel(row[updatedCol + 1])) result.deleted = true
  return result
}
function parseCosts(rawCosts: unknown): CostLine[] {
  try {
    const parsed = JSON.parse(String(rawCosts || '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function fromSheets(sheets: Record<string, SheetRows>): Snapshot {
  const snapshot = emptySnapshot()
  for (const row of body(sheets.Categorias, 7)) {
    snapshot.categories.push({
      ...meta(row, 7), name: String(row[1] ?? ''), rateMode: row[2] === 'derived' ? 'derived' : 'direct',
      ratePerKm: num(row[3]), totalCost: num(row[4]), intervalKm: num(row[5]), active: num(row[6]) === 1 || row[6] === true,
    })
  }
  for (const row of body(sheets.Dias, 7)) {
    snapshot.days.push({ ...meta(row, 7), date: String(row[0]), km: num(row[1]) ?? 0, note: str(row[2]), costs: parseCosts(row[6]) })
  }
  for (const row of body(sheets.Servicios, 5)) {
    snapshot.services.push({
      ...meta(row, 5), date: String(row[1]), amount: num(row[2]) ?? 0, method: str(row[3]) ?? 'cash', note: str(row[4]),
    })
  }
  for (const row of body(sheets.Caja, 5)) {
    snapshot.cash.push({ ...meta(row, 5), date: String(row[0]), opening: num(row[1]) ?? 0, openedAt: String(row[2] ?? ''), closedAt: str(row[3]), counted: num(row[4]) })
  }
  for (const row of body(sheets.Movimientos, 5)) {
    snapshot.movements.push({ ...meta(row, 5), date: String(row[1]), type: String(row[2]), amount: num(row[3]) ?? 0, note: str(row[4]) })
  }
  return snapshot
}
