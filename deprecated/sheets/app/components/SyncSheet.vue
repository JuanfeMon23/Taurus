<script setup lang="ts">
import { CloudUpload, ExternalLink, LogOut, MonitorSmartphone, RefreshCw, X } from 'lucide-vue-next'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { state, sheetUrl, connect, syncNow, disconnect } = useSheetsSync()
const { show } = useToast()

const STATUS: Record<string, string> = {
  off: 'Sin conectar',
  idle: 'Conectado',
  syncing: 'Sincronizando…',
  ok: 'Sincronizado',
  pending: 'Pendiente (sin internet)',
  error: 'Error de sincronización',
}
const when = computed(() =>
  state.lastSync ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.lastSync)) : '—')

async function doConnect() {
  await connect()
  if (state.status === 'ok') show('Conectado con Google Sheets')
}
async function doSync() {
  await syncNow()
  if (state.status === 'ok') show(state.lastPulled ? `${state.lastPulled} registros nuevos de otros dispositivos` : 'Todo al día')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="overlay" @click.self="emit('close')">
        <div class="panel card stack" role="dialog" aria-label="Google Sheets">
          <div class="row between">
            <h2>Google Sheets</h2>
            <button class="btn icon ghost" aria-label="Cerrar" @click="emit('close')"><X :size="20" /></button>
          </div>

          <div class="notice">
            <MonitorSmartphone :size="18" />
            <p class="small">
              El celular y el escritorio comparten la hoja «Taurus — datos» de tu Drive. Cada uno trae los registros que no tiene
              (al abrir la app, cada 5 min y tras cada cambio); los borrados y ediciones también viajan.
            </p>
          </div>

          <div class="status" :class="state.status">
            <span class="dot" />
            <div class="grow">
              <b>{{ STATUS[state.status] }}</b>
              <p class="small muted">Última sincronización: {{ when }}</p>
            </div>
          </div>
          <p v-if="state.error" class="small neg">{{ state.error }}</p>

          <button v-if="!state.connected" class="btn primary block" :disabled="state.status === 'syncing'" @click="doConnect">
            <CloudUpload :size="18" /> Conectar con Google
          </button>

          <template v-else>
            <button class="btn primary block" :disabled="state.status === 'syncing'" @click="doSync">
              <RefreshCw :size="18" :class="{ spin: state.status === 'syncing' }" /> Sincronizar ahora
            </button>
            <a v-if="sheetUrl" class="btn block" :href="sheetUrl" target="_blank" rel="noopener">
              <ExternalLink :size="18" /> Abrir la hoja
            </a>
            <button class="btn block ghost danger" @click="disconnect"><LogOut :size="18" /> Desconectar</button>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.5); display: flex; align-items: flex-end; justify-content: center; backdrop-filter: blur(3px); }
.panel { width: min(520px, 100%); border-radius: 26px 26px 0 0; padding: 18px 18px calc(env(safe-area-inset-bottom) + 22px); }
h2 { font-size: 20px; font-weight: 800; }
.status { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
.status.ok .dot, .status.idle .dot { background: var(--pos); box-shadow: 0 0 0 4px var(--pos-soft); }
.status.syncing .dot, .status.pending .dot { background: var(--accent); animation: pulse 1s infinite; }
.status.error .dot { background: var(--neg); box-shadow: 0 0 0 4px var(--neg-soft); }
.notice { display: flex; gap: 10px; padding: 12px; border-radius: 14px; background: var(--info-soft); color: var(--info); }
.btn:disabled { opacity: 0.6; pointer-events: none; }
a.btn { text-decoration: none; color: inherit; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: 0.35; } }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.25s; }
.sheet-enter-active .panel, .sheet-leave-active .panel { transition: transform 0.4s var(--ease); }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .panel, .sheet-leave-to .panel { transform: translateY(100%); }
</style>
