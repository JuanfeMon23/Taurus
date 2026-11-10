<script setup lang="ts">
import { CalendarCheck, Inbox, Route, Trash2 } from 'lucide-vue-next'
import type { DayRecord, Service } from '../services/types'
import { money } from '../utils/format'
import { formatDuration, tripMinutes } from '../utils/trip'

const days = ref<DayRecord[]>([])
const confirming = ref<string | null>(null)
const { show } = useNotify()

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

async function load() {
  try {
    days.value = await (await useTaurus()).repo.listDays()
  } catch (error) {
    show(errorText(error, 'No se pudo cargar el historial'), 'error')
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
  } catch (error) {
    show(errorText(error, 'No se pudo eliminar'), 'error')
  }
}

const dateFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const label = (iso: string) => dateFormatter.format(new Date(`${iso}T12:00:00`))
const places = (service: Service) => [service.origin, service.destination].filter(Boolean).join(' → ')
const duration = (service: Service) => formatDuration(tripMinutes(service.startTime, service.endTime))
</script>

<template>
  <section class="stack">
    <div v-if="!days.length" class="card empty">
      <Inbox :size="40" />
      <b>Aún no hay días registrados</b>
      <p class="small">Guarda tu primer día desde la pestaña Hoy.</p>
    </div>

    <TransitionGroup v-else name="list" tag="div" class="stack rel rise" style="gap: 10px">
      <div v-for="day in days" :key="day.date" class="card dayc">
        <div class="day">
          <span class="icon-tile" :class="day.net >= 0 ? 'pos' : 'neg'"><CalendarCheck :size="20" /></span>
          <div class="grow">
            <b class="cap">{{ label(day.date) }}</b>
            <p class="muted small row" style="gap: 6px">
              <Route :size="13" /> {{ day.km }} km · bruto {{ money(day.gross) }}
            </p>
            <p v-if="day.commission + day.commissionVat > 0" class="muted small">
              Comisión inDrive {{ money(day.commission + day.commissionVat) }} · neto con comisión
            </p>
          </div>
          <b class="num net" :class="day.net >= 0 ? 'pos' : 'neg'">{{ money(day.net) }}</b>
          <button class="btn icon ghost" :class="{ danger: confirming === day.date }" :aria-label="confirming === day.date ? 'Confirmar' : 'Eliminar'" @click="remove(day.date)">
            <Trash2 :size="18" />
          </button>
        </div>
        <ul v-if="day.services.length" class="trips">
          <li v-for="(service, i) in day.services" :key="service.id ?? i">
            <div class="row between">
              <span class="small">
                <template v-if="service.startTime && service.endTime">{{ service.startTime }}–{{ service.endTime }}<template v-if="duration(service)"> · {{ duration(service) }}</template></template>
                <template v-else>Servicio</template>
                <template v-if="service.distanceKm !== undefined"> · {{ service.distanceKm }} km</template>
              </span>
              <b class="num small">{{ money(service.amount) }}</b>
            </div>
            <p v-if="(service.bonus ?? 0) > 0" class="muted small">+ {{ money(service.bonus!) }} bonus</p>
            <p v-if="service.isIndrive === false" class="muted small">Propio</p>
            <p v-else-if="(service.commission ?? 0) > 0" class="muted small">Comisión {{ money(service.commission!) }} + IVA {{ money(service.commissionVat ?? 0) }}</p>
            <p v-if="places(service)" class="muted small">{{ places(service) }}</p>
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
