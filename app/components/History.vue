<script setup lang="ts">
import { CalendarCheck, Inbox, Route, Trash2 } from 'lucide-vue-next'
import type { DayRecord, Service } from '../services/types'
import { money } from '../utils/format'
import { formatDuration, tripMinutes } from '../utils/trip'

const days = ref<DayRecord[]>([])
const confirming = ref<string | null>(null)
const { show } = useToast()

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

async function load() {
  try {
    days.value = await (await useTaurus()).repo.listDays()
  } catch (e) {
    show(errorText(e, 'No se pudo cargar el historial'), 'error')
  }
}
onMounted(load)
onActivated(load)

async function remove(date: string) {
  if (confirming.value !== date) {
    confirming.value = date
    setTimeout(() => confirming.value === date && (confirming.value = null), 2500)
    return
  }
  try {
    await (await useTaurus()).repo.deleteDay(date)
    confirming.value = null
    show('Día eliminado')
    await load()
  } catch (e) {
    show(errorText(e, 'No se pudo eliminar'), 'error')
  }
}

const fmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const label = (iso: string) => fmt.format(new Date(`${iso}T12:00:00`))
const places = (x: Service) => [x.origin, x.destination].filter(Boolean).join(' → ')
const duration = (x: Service) => formatDuration(tripMinutes(x.startTime, x.endTime))
</script>

<template>
  <section class="stack">
    <div v-if="!days.length" class="card empty">
      <Inbox :size="40" />
      <b>Aún no hay días registrados</b>
      <p class="small">Guarda tu primer día desde la pestaña Hoy.</p>
    </div>

    <TransitionGroup v-else name="list" tag="div" class="stack rel rise" style="gap: 10px">
      <div v-for="d in days" :key="d.date" class="card dayc">
        <div class="day">
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
        <ul v-if="d.services.length" class="trips">
          <li v-for="(x, i) in d.services" :key="x.id ?? i">
            <div class="row between">
              <span class="small">
                <template v-if="x.startTime && x.endTime">{{ x.startTime }}–{{ x.endTime }}<template v-if="duration(x)"> · {{ duration(x) }}</template></template>
                <template v-else>Servicio</template>
                <template v-if="x.distanceKm !== undefined"> · {{ x.distanceKm }} km</template>
              </span>
              <b class="num small">{{ money(x.amount) }}</b>
            </div>
            <p v-if="(x.bonus ?? 0) > 0" class="muted small">+ {{ money(x.bonus!) }} bonus</p>
            <p v-if="places(x)" class="muted small">{{ places(x) }}</p>
          </li>
        </ul>
      </div>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.rel { position: relative; }
.cap { text-transform: capitalize; }
.dayc { padding: 12px 14px; }
.day { display: flex; align-items: center; gap: 12px; }
.net { font-size: 16px; }
.danger { background: var(--neg-soft); }
.trips { list-style: none; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
</style>
