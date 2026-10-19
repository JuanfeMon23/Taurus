<script setup lang="ts">
import { CalendarCheck, Inbox, Route, Trash2 } from 'lucide-vue-next'
import type { DayRecord } from '../services/types'
import { money } from '../utils/format'

const days = ref<DayRecord[]>([])
const confirming = ref<string | null>(null)
const { show } = useToast()

async function load() {
  days.value = await (await useTaurus()).repo.listDays()
}
onMounted(load)
onActivated(load)

async function remove(date: string) {
  if (confirming.value !== date) {
    confirming.value = date
    setTimeout(() => confirming.value === date && (confirming.value = null), 2500)
    return
  }
  await (await useTaurus()).repo.deleteDay(date)
  confirming.value = null
  show('Día eliminado')
  await load()
}

const fmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const label = (iso: string) => fmt.format(new Date(`${iso}T12:00:00`))
</script>

<template>
  <section class="stack">
    <div v-if="!days.length" class="card empty">
      <Inbox :size="40" />
      <b>Aún no hay días registrados</b>
      <p class="small">Guarda tu primer día desde la pestaña Hoy.</p>
    </div>

    <TransitionGroup v-else name="list" tag="div" class="stack rel rise" style="gap: 10px">
      <div v-for="d in days" :key="d.date" class="card day">
        <span class="icon-tile" :class="d.net >= 0 ? 'pos' : 'neg'"><CalendarCheck :size="20" /></span>
        <div class="grow">
          <b class="cap">{{ label(d.date) }}</b>
          <p class="muted small row" style="gap: 6px">
            <Route :size="13" /> {{ d.km }} km · bruto {{ money(d.gross) }}
          </p>
        </div>
        <b class="num net" :class="d.net >= 0 ? 'pos' : 'neg'">{{ money(d.net) }}</b>
        <button class="btn icon ghost" :class="{ danger: confirming === d.date }" :aria-label="confirming === d.date ? 'Confirmar' : 'Eliminar'" @click="remove(d.date)">
          <Trash2 :size="18" />
        </button>
      </div>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.rel { position: relative; }
.cap { text-transform: capitalize; }
.day { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.net { font-size: 16px; }
.danger { background: var(--neg-soft); }
</style>
