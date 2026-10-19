import { authSupported, getToken, signOut } from '../services/sheets/auth'
import { createSync, type Sync } from '../services/sheets/sync'
import { onDataChange } from '../utils/bus'

type Status = 'off' | 'idle' | 'syncing' | 'ok' | 'pending' | 'error'

const KEY = 'taurus-sheets'
const PERIOD_MS = 5 * 60_000
const state = reactive({
  connected: false,
  sheetId: null as string | null,
  lastSync: null as string | null,
  lastPulled: 0,
  status: 'off' as Status,
  error: '',
})
let sync: Sync | null = null
let started = false
let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ connected: state.connected, sheetId: state.sheetId, lastSync: state.lastSync }))
  } catch { /* sin storage */ }
}

/**
 * Sincronización con Google Sheets (bidireccional, local-primero).
 * Se ejecuta al abrir la app, al volver a ella, cada 5 min, tras cada cambio y al recuperar internet.
 */
export function useSheetsSync() {
  const config = useRuntimeConfig()
  const supported = import.meta.client && authSupported()

  async function ensure(): Promise<Sync> {
    if (sync) return sync
    const taurus = await useTaurus()
    sync = createSync({
      taurus,
      token: interactive => getToken(config.public as Record<string, string>, interactive),
      getSheetId: () => state.sheetId,
      setSheetId: id => { state.sheetId = id; persist() },
    })
    return sync
  }

  /** Una sola sincronización a la vez; si llega otra petición mientras corre, se repite al terminar. */
  function run(interactive = false): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      state.status = 'syncing'
      state.error = ''
      try {
        const r = await (await ensure()).sync(interactive)
        Object.assign(state, { connected: true, lastSync: new Date().toISOString(), lastPulled: r.pulled, status: 'ok' })
        persist()
      } catch (e) {
        state.status = navigator.onLine ? 'error' : 'pending'
        state.error = e instanceof Error ? e.message : String(e)
      } finally {
        running = null
        if (again) {
          again = false
          void run(false)
        }
      }
    })()
    return running
  }

  const auto = () => state.connected && navigator.onLine && run(false)

  if (supported && !started) {
    started = true
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
      if (saved) Object.assign(state, { connected: !!saved.connected, sheetId: saved.sheetId ?? null, lastSync: saved.lastSync ?? null })
    } catch { /* estado corrupto: se ignora */ }
    state.status = state.connected ? 'idle' : 'off'

    onDataChange(() => {
      if (!state.connected) return
      state.status = navigator.onLine ? 'syncing' : 'pending'
      clearTimeout(timer)
      timer = setTimeout(auto, 3000)
    })
    window.addEventListener('online', auto)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && auto())
    setInterval(auto, PERIOD_MS)
    setTimeout(auto, 1500) // al abrir: traer lo que otros dispositivos registraron
  }

  return {
    state,
    supported,
    sheetUrl: computed(() => (state.sheetId ? `https://docs.google.com/spreadsheets/d/${state.sheetId}` : null)),
    /** Conecta con Google (consentimiento) y sincroniza. */
    connect: () => run(true),
    syncNow: () => run(state.status === 'error'),
    async disconnect() {
      await signOut()
      clearTimeout(timer)
      Object.assign(state, { connected: false, status: 'off', error: '', sheetId: null, lastSync: null, lastPulled: 0 })
      persist()
    },
  }
}
