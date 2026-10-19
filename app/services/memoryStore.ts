import { fromLegacy } from './legacy'
import { emptySnapshot, type Collection, type Meta, type Snapshot, type Store } from './types'

interface KV {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KEY = 'taurus-state'

/** Inserta o reemplaza por id. */
export function upsert(target: Snapshot, changes: Partial<Snapshot>) {
  for (const col of Object.keys(changes) as Collection[]) {
    const list = target[col] as Meta[]
    for (const rec of (changes[col] ?? []) as Meta[]) {
      const i = list.findIndex(r => r.id === rec.id)
      if (i >= 0) list[i] = rec
      else list.push(rec)
    }
  }
}

/** Almacén en memoria; persiste en `kv` si se entrega (localStorage en el navegador). Migra el formato anterior. */
export function createMemoryStore(kv?: KV): Store {
  let state = emptySnapshot()
  const persist = () => kv?.setItem(KEY, JSON.stringify({ version: 2, ...state }))

  const raw = kv?.getItem(KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed.version === 2) state = { ...emptySnapshot(), ...parsed, version: undefined }
    else {
      state = fromLegacy(parsed)
      persist()
    }
    delete (state as any).version
  }

  return {
    async load() {
      return structuredClone(state)
    },
    async save(changes) {
      upsert(state, structuredClone(changes))
      persist()
    },
  }
}
