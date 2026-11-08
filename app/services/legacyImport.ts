import { fromLegacy } from './legacy'
import { emptySnapshot, type Collection, type Snapshot, type Store } from './types'

interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const LEGACY_KEY = 'taurus-state'
export const IMPORTED_KEY = 'taurus-api-imported'

const COLLECTIONS: Collection[] = ['categories', 'days', 'services', 'cash', 'movements', 'depositMovements', 'fundMovements', 'shifts']
const isEmpty = (snapshot: Snapshot) => COLLECTIONS.every(collection => !snapshot[collection]?.length)

/**
 * Importación única del localStorage al backend: solo si el backend está vacío y existe `taurus-state`.
 * Marca que ya se hizo y no borra `taurus-state`. Devuelve true si subió datos.
 */
export async function importLocalOnce(store: Store, kv: KV): Promise<boolean> {
  if (kv.getItem(IMPORTED_KEY)) return false
  if (!isEmpty(await store.load())) {
    kv.setItem(IMPORTED_KEY, new Date().toISOString())
    return false
  }
  const raw = kv.getItem(LEGACY_KEY)
  if (!raw) return false // nada que importar; se reintenta si más tarde aparece (no se marca)
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  let snapshot: Snapshot
  if (parsed?.version === 2) {
    const { version: _version, ...rest } = parsed
    snapshot = { ...emptySnapshot(), ...rest }
  } else {
    snapshot = fromLegacy(parsed)
  }
  if (!isEmpty(snapshot)) await store.save(snapshot)
  kv.setItem(IMPORTED_KEY, new Date().toISOString())
  return !isEmpty(snapshot)
}
