import { emptySnapshot, type Collection, type Meta, type Snapshot } from './types'

const COLLECTIONS: Collection[] = ['categories', 'days', 'services', 'cash', 'movements']

/** a gana a b si es más reciente; en empate gana el borrado (los borrados no "reviven"). */
function wins(a: Meta, b: Meta) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt
  return !!a.deleted && !b.deleted
}

/** JSON canónico: claves ordenadas y sin campos undefined (el orden de las claves no cuenta como cambio). */
function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`
  if (x && typeof x === 'object') {
    const entries = Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(',')}}`
  }
  return JSON.stringify(x)
}
export const same = (a: unknown, b: unknown) => canon(a) === canon(b)

export interface MergeResult {
  merged: Snapshot
  /** Registros que el dispositivo local debe guardar (nuevos o más recientes en la hoja). */
  toLocal: Snapshot
  /** true si la hoja quedó desactualizada y hay que reescribirla. */
  remoteChanged: boolean
}

/** Fusión bidireccional por id, "la edición más reciente gana" (last-write-wins). */
export function mergeSnapshots(local: Snapshot, remote: Snapshot): MergeResult {
  const merged = emptySnapshot()
  const toLocal = emptySnapshot()
  let remoteChanged = false

  for (const col of COLLECTIONS) {
    const l = new Map((local[col] as Meta[]).map(r => [r.id, r]))
    const r = new Map((remote[col] as Meta[]).map(x => [x.id, x]))
    const out: Meta[] = []
    const pull: Meta[] = []
    for (const id of new Set([...l.keys(), ...r.keys()])) {
      const a = l.get(id)
      const b = r.get(id)
      const pick = !b ? a! : !a ? b : wins(b, a) ? b : a
      out.push(pick)
      if (!a || (pick === b && !same(a, b))) pull.push(pick)
      if (!b || (pick === a && !same(a, b))) remoteChanged = true
    }
    ;(merged[col] as Meta[]) = out
    ;(toLocal[col] as Meta[]) = pull
  }
  return { merged, toLocal, remoteChanged }
}
