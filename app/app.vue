<script setup lang="ts">
import { BarChart3, CalendarDays, CircleCheck, CircleAlert, Cloud, CloudOff, History as HistoryIcon, Moon, SlidersHorizontal, Sun, Wallet } from 'lucide-vue-next'
import SyncSheet from './components/SyncSheet.vue'
import Cash from './components/Cash.vue'
import DayForm from './components/DayForm.vue'
import HistoryView from './components/History.vue'
import Rates from './components/Rates.vue'
import Stats from './components/Stats.vue'

const tabs = [
  { key: 'hoy', label: 'Hoy', icon: CalendarDays, view: DayForm },
  { key: 'caja', label: 'Caja', icon: Wallet, view: Cash },
  { key: 'historial', label: 'Historial', icon: HistoryIcon, view: HistoryView },
  { key: 'stats', label: 'Stats', icon: BarChart3, view: Stats },
  { key: 'tarifas', label: 'Tarifas', icon: SlidersHorizontal, view: Rates },
] as const

const index = ref(0)
const current = computed(() => tabs[index.value]!)
const { theme, toggle } = useTheme()
const { toasts } = useToast()
const sheets = useSheetsSync()
const showSync = ref(false)

const rawDate = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
const today = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)
</script>

<template>
  <div class="app">
    <NuxtPwaManifest />

    <header class="row between top">
      <div class="row">
        <svg class="logo" viewBox="0 0 512 512" aria-hidden="true">
          <rect width="512" height="512" rx="120" fill="url(#g)" />
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#ffb020" /><stop offset="1" stop-color="#ff7a18" />
            </linearGradient>
          </defs>
          <path d="M120 150c0 56 40 92 76 98v52c-62 8-100 52-100 108h40c0-40 30-64 68-64h104c38 0 68 24 68 64h40c0-56-38-100-100-108v-52c36-6 76-42 76-98h-40c0 40-28 64-64 64h-64c-36 0-64-24-64-64z" fill="#1a1203" />
        </svg>
        <div>
          <h1>Taurus</h1>
          <p class="muted small">{{ today }}</p>
        </div>
      </div>
      <div class="row" style="gap: 2px">
        <button class="btn icon ghost theme sync" aria-label="Google Sheets" @click="showSync = true">
          <component :is="sheets.state.status === 'error' || sheets.state.status === 'pending' ? CloudOff : Cloud" :size="22" />
          <i class="dot" :class="sheets.state.connected ? sheets.state.status : 'off'" />
        </button>
        <button class="btn icon ghost theme" :aria-label="theme === 'dark' ? 'Tema claro' : 'Tema oscuro'" @click="toggle">
          <Transition name="spin" mode="out-in">
            <Sun v-if="theme === 'dark'" :size="22" />
            <Moon v-else :size="22" />
          </Transition>
        </button>
      </div>
    </header>

    <main>
      <Transition name="page" mode="out-in">
        <KeepAlive>
          <component :is="current.view" :key="current.key" />
        </KeepAlive>
      </Transition>
    </main>

    <nav class="tabbar" aria-label="Secciones">
      <span class="pill" :style="{ '--i': index }" />
      <button v-for="(t, i) in tabs" :key="t.key" :class="{ active: i === index }" :aria-label="t.label" @click="index = i">
        <component :is="t.icon" :size="22" :stroke-width="i === index ? 2.4 : 1.9" />
        <span>{{ t.label }}</span>
      </button>
    </nav>

    <SyncSheet :open="showSync" @close="showSync = false" />

    <TransitionGroup name="toast" tag="div" class="toasts">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        <CircleCheck v-if="t.kind === 'ok'" :size="18" />
        <CircleAlert v-else :size="18" />
        {{ t.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
.top { padding: 6px 2px 18px; }
.top h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
.cap { text-transform: capitalize; }
.logo { width: 42px; height: 42px; filter: drop-shadow(0 6px 14px rgba(255, 140, 20, 0.35)); }
.theme { color: var(--text-2); }
.sync { position: relative; }
.sync .dot { position: absolute; top: 7px; right: 7px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--bg); background: transparent; }
.sync .dot.ok, .sync .dot.idle { background: var(--pos); }
.sync .dot.syncing, .sync .dot.pending { background: var(--accent); }
.sync .dot.error { background: var(--neg); }

main { position: relative; }

.tabbar {
  position: fixed; z-index: 20;
  left: 50%; transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom) + 12px);
  width: min(496px, calc(100% - 24px));
  display: grid; grid-template-columns: repeat(5, 1fr);
  padding: 6px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow);
}
.tabbar .pill {
  position: absolute; top: 6px; bottom: 6px; left: 6px;
  width: calc((100% - 12px) / 5);
  background: var(--accent-soft);
  border-radius: 16px;
  transform: translateX(calc(var(--i) * 100%));
  transition: transform 0.4s var(--ease);
}
.tabbar button {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 9px 0 7px;
  color: var(--muted); font-size: 11px; font-weight: 600;
  transition: color 0.25s, transform 0.15s var(--ease);
}
.tabbar button:active { transform: scale(0.9); }
.tabbar button.active { color: var(--accent); }
.tabbar button.active svg { animation: pop 0.35s var(--ease); }

.spin-enter-active, .spin-leave-active { transition: transform 0.25s var(--ease), opacity 0.2s; }
.spin-enter-from { transform: rotate(-90deg) scale(0.6); opacity: 0; }
.spin-leave-to { transform: rotate(90deg) scale(0.6); opacity: 0; }

.toasts { position: fixed; z-index: 30; left: 0; right: 0; top: calc(env(safe-area-inset-top) + 12px); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
.toast {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 16px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow); font-weight: 600;
}
.toast.ok svg { color: var(--pos); }
.toast.error svg { color: var(--neg); }
.toast-enter-active, .toast-leave-active { transition: all 0.35s var(--ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(-16px) scale(0.95); }
</style>
