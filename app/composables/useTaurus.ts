import { createApiStore } from '../services/apiStore'
import { importLocalOnce } from '../services/legacyImport'
import { createTaurus, type Taurus } from '../services/taurus'
import type { Store } from '../services/types'
import { emitDataChange } from '../utils/bus'

let instance: Promise<Taurus> | null = null

/** Singleton sobre el backend local (API). Cada escritura emite un aviso de cambio de datos. */
export function useTaurus(): Promise<Taurus> {
  instance ??= (async () => {
    const store: Store = createApiStore(useRuntimeConfig().public.apiBase as string)
    await importLocalOnce(store, localStorage) // antes de init(): la siembra no debe ocultar un backend vacío
    const taurus = createTaurus(store, { onChange: emitDataChange })
    await taurus.init()
    return taurus
  })()
  return instance
}
