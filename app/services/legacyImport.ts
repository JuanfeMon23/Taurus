import { DEPOSIT_ACCOUNT_ID } from '../utils/accounts'
import { movementAccountId } from '../utils/catalogs'
import { fromLegacy } from './legacy'
import { emptySnapshot, type Collection, type Snapshot, type Store } from './types'

interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const LEGACY_KEY = 'taurus-state'
export const IMPORTED_KEY = 'taurus-api-imported'

const COLLECTIONS: Collection[] = ['categories', 'days', 'services', 'cash', 'movements', 'fundMovements', 'shifts']
const isEmpty = (snapshot: Snapshot) => COLLECTIONS.every(collection => !snapshot[collection]?.length)

/**
 * Importación única del localStorage al backend: solo si el backend está vacío y existe `taurus-state`.
 * Marca que ya se hizo y no borra `taurus-state`. Devuelve true si subió datos.
 */
export async function importLocalOnce(store: Store, kv: KV): Promise<boolean> {
  if (kv.getItem(IMPORTED_KEY)) return false
  const remote = await store.load()
  if (!isEmpty(remote)) {
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
  let oldOutflows: { id: string; date: string; amount: number; note?: string; updatedAt: string; deleted?: boolean }[] = []
  if (parsed?.version === 2) {
    const { version: _version, depositMovements = [], ...rest } = parsed
    snapshot = { ...emptySnapshot(), ...rest }
    oldOutflows = depositMovements
  } else {
    snapshot = fromLegacy(parsed)
  }
  // Los movimientos viejos con medio llevan la cuenta de su medio; las salidas del depósito ya son movimientos de la cuenta depósito.
  snapshot.movements = [
    ...snapshot.movements.map(({ method, ...movement }) => ({ ...movement, accountId: movementAccountId({ accountId: movement.accountId, method }, remote) ?? '' })),
    ...oldOutflows.filter(outflow => !outflow.deleted)
      .map(outflow => ({ id: outflow.id, date: outflow.date, type: 'withdrawal', amount: outflow.amount, note: outflow.note, accountId: DEPOSIT_ACCOUNT_ID, updatedAt: outflow.updatedAt })),
  ]
  if (!isEmpty(snapshot)) await store.save(snapshot)
  kv.setItem(IMPORTED_KEY, new Date().toISOString())
  return !isEmpty(snapshot)
}
