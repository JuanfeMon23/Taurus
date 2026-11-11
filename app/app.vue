<script setup lang="ts">
import { BarChart3, CalendarDays, CircleCheck, CircleAlert, History as HistoryIcon, Moon, PiggyBank, SlidersHorizontal, Sun, Wallet } from 'lucide-vue-next'
import AppSidebar from './components/AppSidebar.vue'
import Cash from './components/Cash.vue'
import Funds from './components/Funds.vue'
import DayForm from './components/DayForm.vue'
import HistoryView from './components/History.vue'
import Rates from './components/Rates.vue'
import Stats from './components/Stats.vue'

const tabs = [
  { key: 'hoy', label: 'Hoy', icon: CalendarDays, view: DayForm },
  { key: 'caja', label: 'Caja', icon: Wallet, view: Cash },
  { key: 'fondos', label: 'Fondos', icon: PiggyBank, view: Funds },
  { key: 'historial', label: 'Historial', icon: HistoryIcon, view: HistoryView },
  { key: 'stats', label: 'Estadísticas', icon: BarChart3, view: Stats },
  { key: 'tarifas', label: 'Tarifas', icon: SlidersHorizontal, view: Rates },
] as const

const index = ref(0)
const SIDEBAR_KEY = 'taurus-sidebar-collapsed'
const collapsed = ref(false)
onMounted(() => { collapsed.value = localStorage.getItem(SIDEBAR_KEY) === '1' })
watch(collapsed, isCollapsed => localStorage.setItem(SIDEBAR_KEY, isCollapsed ? '1' : '0'))
const select = (key: string) => { index.value = Math.max(0, tabs.findIndex(tab => tab.key === key)) }
const current = computed(() => tabs[index.value]!)
const { theme, toggle } = useTheme()
const { toasts } = useNotify()

const rawDate = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
const today = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)
</script>

<template>
  <div class="app desktop" :style="{ '--sidebar-w': collapsed ? '72px' : '232px' }">
    <AppSidebar v-model:collapsed="collapsed" :items="tabs" :active="current.key" @select="select" />
    <NuxtPwaManifest />

    <header class="row between top" :class="{ wide: current.key === 'hoy' }">
      <div>
        <h1>{{ current.label }}</h1>
        <p class="muted small">{{ today }}</p>
      </div>
      <div class="row" style="gap: 2px">
        <button class="btn icon ghost theme" :aria-label="theme === 'dark' ? 'Tema claro' : 'Tema oscuro'" @click="toggle">
          <Transition name="spin" mode="out-in">
            <Sun v-if="theme === 'dark'" :size="22" />
            <Moon v-else :size="22" />
          </Transition>
        </button>
      </div>
    </header>

    <main :class="{ wide: current.key === 'hoy' }">
      <Transition name="page" mode="out-in">
        <KeepAlive>
          <component :is="current.view" :key="current.key" />
        </KeepAlive>
      </Transition>
    </main>

    <TransitionGroup name="toast" tag="div" class="toasts">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">
        <CircleCheck v-if="toast.kind === 'ok'" :size="18" />
        <CircleAlert v-else :size="18" />
        {{ toast.text }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style>
.top { padding: 6px 2px 18px; }
.top h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
.cap { text-transform: capitalize; }
.theme { color: var(--text-2); }

main { position: relative; }

/* Escritorio (web): contenido a la derecha de la barra lateral. */
.app.desktop { max-width: none; margin: 0; padding: 24px 32px 48px calc(var(--sidebar-w) + 32px); transition: padding-left 0.25s var(--ease); }
.app.desktop > header, .app.desktop > main { max-width: 1280px; }
.app.desktop > header.wide, .app.desktop > main.wide { max-width: none; }
.app.desktop .top { padding-top: 0; }

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
