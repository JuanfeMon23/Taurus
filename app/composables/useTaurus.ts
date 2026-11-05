import { Capacitor } from '@capacitor/core'
import { createApiStore } from '../services/apiStore'
import { importLocalOnce } from '../services/legacyImport'
import { createTaurus, type Taurus } from '../services/taurus'
import type { Store } from '../services/types'
import { emitDataChange } from '../utils/bus'

let instance: Promise<Taurus> | null = null

/** Singleton: SQLite en Android, backend local (API) en el navegador / PWA. Cada escritura avisa a la sincronización. */
export function useTaurus(): Promise<Taurus> {
  instance ??= (async () => {
    let store: Store
    if (Capacitor.isNativePlatform()) {
      store = await (await import('../services/sqliteStore')).createSqliteStore()
    } else {
      store = createApiStore(useRuntimeConfig().public.apiBase as string)
      await importLocalOnce(store, localStorage) // antes de init(): la siembra no debe ocultar un backend vacío
    }
    const t = createTaurus(store, { onChange: emitDataChange })
    await t.init()
    return t
  })()
  return instance
}
