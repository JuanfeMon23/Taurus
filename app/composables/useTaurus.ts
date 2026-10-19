import { Capacitor } from '@capacitor/core'
import { createMemoryStore } from '../services/memoryStore'
import { createTaurus, type Taurus } from '../services/taurus'
import { emitDataChange } from '../utils/bus'

let instance: Promise<Taurus> | null = null

/** Singleton: SQLite en Android, localStorage en el navegador / PWA. Cada escritura avisa a la sincronización. */
export function useTaurus(): Promise<Taurus> {
  instance ??= (async () => {
    const store = Capacitor.isNativePlatform()
      ? await (await import('../services/sqliteStore')).createSqliteStore()
      : createMemoryStore(localStorage)
    const t = createTaurus(store, { onChange: emitDataChange })
    await t.init()
    return t
  })()
  return instance
}
