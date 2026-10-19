import type { CostLine } from '../../utils/calc'
import { emptySnapshot, type MovementType, type Snapshot } from '../types'

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

const v = (x: unknown): Cell => (x === undefined || x === null ? '' : (x as Cell))
const del = (d?: boolean): Cell => (d ? 1 : '')

export function toSheets(s: Snapshot): Record<string, SheetRows> {
  const out: Record<string, SheetRows> = Object.fromEntries(SHEETS.map(x => [x.title, [[...x.headers]]]))

  for (const c of s.categories) {
    out.Categorias!.push([c.id, c.name, c.rateMode, v(c.ratePerKm), v(c.totalCost), v(c.intervalKm), c.active ? 1 : 0, c.updatedAt, del(c.deleted)])
  }
  for (const d of s.days) {
    // bruto/costos/neto son informativos para quien abre la hoja; al importar se recalculan.
    const gross = s.services.filter(x => x.date === d.date && !x.deleted).reduce((t, x) => t + x.amount, 0)
    const cost = d.costs.reduce((t, c) => t + c.amount, 0)
    out.Dias!.push([d.id, d.km, v(d.note), gross, cost, gross - cost, JSON.stringify(d.costs), d.updatedAt, del(d.deleted)])
  }
  for (const x of s.services) out.Servicios!.push([x.id, x.date, x.amount, x.method, v(x.note), x.updatedAt, del(x.deleted)])
  for (const c of s.cash) out.Caja!.push([c.id, c.opening, c.openedAt, v(c.closedAt), v(c.counted), c.updatedAt, del(c.deleted)])
  for (const m of s.movements) out.Movimientos!.push([m.id, m.date, m.type, m.amount, v(m.note), m.updatedAt, del(m.deleted)])
  return out
}

const str = (x: unknown) => (x === '' || x == null ? undefined : String(x))
const num = (x: unknown) => {
  if (x === '' || x == null) return undefined
  const n = Number(x)
  return Number.isFinite(n) ? n : undefined
}
const isDel = (x: unknown) => x === 1 || x === '1' || x === true || x === 'TRUE'

/** Filas válidas: con id y fecha de edición (lo demás se ignora). */
function body(rows: SheetRows | undefined, updatedCol: number) {
  return (rows ?? []).slice(1).filter(r => str(r[0]) && str(r[updatedCol]))
}
function meta(r: Cell[], updatedCol: number) {
  const m: { id: string; updatedAt: string; deleted?: boolean } = { id: String(r[0]), updatedAt: String(r[updatedCol]) }
  if (isDel(r[updatedCol + 1])) m.deleted = true
  return m
}
function parseCosts(x: unknown): CostLine[] {
  try {
    const arr = JSON.parse(String(x || '[]'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function fromSheets(sheets: Record<string, SheetRows>): Snapshot {
  const s = emptySnapshot()
  for (const r of body(sheets.Categorias, 7)) {
    s.categories.push({
      ...meta(r, 7), name: String(r[1] ?? ''), rateMode: r[2] === 'derived' ? 'derived' : 'direct',
      ratePerKm: num(r[3]), totalCost: num(r[4]), intervalKm: num(r[5]), active: num(r[6]) === 1 || r[6] === true,
    })
  }
  for (const r of body(sheets.Dias, 7)) {
    s.days.push({ ...meta(r, 7), date: String(r[0]), km: num(r[1]) ?? 0, note: str(r[2]), costs: parseCosts(r[6]) })
  }
  for (const r of body(sheets.Servicios, 5)) {
    s.services.push({
      ...meta(r, 5), date: String(r[1]), amount: num(r[2]) ?? 0, method: r[3] === 'transfer' ? 'transfer' : 'cash', note: str(r[4]),
    })
  }
  for (const r of body(sheets.Caja, 5)) {
    s.cash.push({ ...meta(r, 5), date: String(r[0]), opening: num(r[1]) ?? 0, openedAt: String(r[2] ?? ''), closedAt: str(r[3]), counted: num(r[4]) })
  }
  for (const r of body(sheets.Movimientos, 5)) {
    s.movements.push({ ...meta(r, 5), date: String(r[1]), type: String(r[2]) as MovementType, amount: num(r[3]) ?? 0, note: str(r[4]) })
  }
  return s
}
