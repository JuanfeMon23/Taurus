import { emptySnapshot, type Collection, type Meta, type Snapshot } from './types'

const COLLECTIONS: Collection[] = ['categories', 'days', 'services', 'cash', 'movements']

/** `candidate` gana a `rival` si es más reciente; en empate gana el borrado (los borrados no "reviven"). */
function wins(candidate: Meta, rival: Meta) {
  if (candidate.updatedAt !== rival.updatedAt) return candidate.updatedAt > rival.updatedAt
  return !!candidate.deleted && !rival.deleted
}

/** JSON canónico: claves ordenadas y sin campos undefined (el orden de las claves no cuenta como cambio). */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canon(entryValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
export const same = (first: unknown, second: unknown) => canon(first) === canon(second)

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

  for (const collection of COLLECTIONS) {
    const localById = new Map((local[collection] as Meta[]).map(record => [record.id, record]))
    const remoteById = new Map((remote[collection] as Meta[]).map(record => [record.id, record]))
    const out: Meta[] = []
    const pull: Meta[] = []
    for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
      const localRecord = localById.get(id)
      const remoteRecord = remoteById.get(id)
      const pick = !remoteRecord ? localRecord! : !localRecord ? remoteRecord : wins(remoteRecord, localRecord) ? remoteRecord : localRecord
      out.push(pick)
      if (!localRecord || (pick === remoteRecord && !same(localRecord, remoteRecord))) pull.push(pick)
      if (!remoteRecord || (pick === localRecord && !same(localRecord, remoteRecord))) remoteChanged = true
    }
    ;(merged[collection] as Meta[]) = out
    ;(toLocal[collection] as Meta[]) = pull
  }
  return { merged, toLocal, remoteChanged }
}
