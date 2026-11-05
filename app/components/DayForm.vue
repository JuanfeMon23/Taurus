<script setup lang="ts">
import { ArrowLeftRight, Banknote, CalendarDays, Check, Clock, Gift, MapPin, NotebookPen, Pencil, Route, Trash2, TrendingDown, TrendingUp, X } from 'lucide-vue-next'
import { computeDay, type Category } from '../utils/calc'
import { dayKm, dayTotals, extraKmFrom, removeTrip, sortTrips, tripSummary, upsertTrip } from '../utils/dayTrips'
import { money, rate, todayISO } from '../utils/format'
import { categoryIcon } from '../utils/icons'
import { formatDuration, sumDistance, tripMinutes, tripTotal, validateTrip, type TripErrors } from '../utils/trip'
import type { PayMethod, Service } from '../services/types'

// Un solo formulario de viaje; al guardar el viaje queda en el día y el formulario se vacía.
// El id se conserva al editar para que la sincronización reconozca el mismo servicio.
type Form = {
  id?: string
  startTime: string
  endTime: string
  distanceKm: number | null
  amount: number | null
  bonus: number | null
  method: PayMethod
  origin: string
  destination: string
}
const blank = (): Form => ({ startTime: '', endTime: '', distanceKm: null, amount: null, bonus: null, method: 'cash', origin: '', destination: '' })

const date = ref(todayISO())
const extraKm = ref<number | null>(null)
const note = ref('')
const trips = ref<Service[]>([])
const form = ref<Form>(blank())
const categories = ref<Category[]>([])
const saving = ref(false)
const cashKey = ref(0) // se incrementa al cambiar los viajes para recargar la caja
const attempted = ref(false)
const confirming = ref<string | null>(null)
const firstField = ref<HTMLInputElement | null>(null)
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

function resetForm() {
  form.value = blank()
  attempted.value = false
  nextTick(() => firstField.value?.focus())
}

async function load() {
  const existing = await taurus.repo.getDay(date.value)
  trips.value = existing?.services ?? []
  const extra = existing ? extraKmFrom(existing.km, trips.value) : 0
  extraKm.value = extra > 0 ? extra : null
  note.value = existing?.note ?? ''
  confirming.value = null
  form.value = blank()
  attempted.value = false
}

onMounted(async () => {
  try {
    taurus = await useTaurus()
    categories.value = await taurus.repo.listCategories()
    await load()
  } catch (e) {
    show(errorText(e, 'No se pudo cargar'), 'error')
  }
})
// KeepAlive: refrescar tarifas si cambiaron en la pestaña Tarifas.
onActivated(async () => {
  if (taurus) categories.value = await taurus.repo.listCategories()
})
watch(date, async () => {
  if (!taurus) return
  try {
    await load()
  } catch (e) {
    show(errorText(e, 'No se pudo cargar'), 'error')
  }
})

const sorted = computed(() => sortTrips(trips.value))
const totalKm = computed(() => dayKm(trips.value, extraKm.value ?? 0))
const totals = computed(() => dayTotals(trips.value, totalKm.value, categories.value))
const result = computed(() => computeDay({ services: trips.value.map(tripTotal), km: totalKm.value, categories: categories.value }))
const costShare = (amount: number) => (result.value.totalCost > 0 ? Math.max((amount / result.value.totalCost) * 100, 4) : 0)
const margin = computed(() => (totals.value.gross > 0 ? Math.round((totals.value.net / totals.value.gross) * 100) : 0))

const tripKm = computed(() => sumDistance(trips.value))
const duration = computed(() => formatDuration(tripMinutes(form.value.startTime, form.value.endTime)))
const errors = computed<TripErrors>(() => validateTrip(form.value))
const showErr = (f: keyof TripErrors) => (attempted.value ? errors.value[f] : undefined)

async function persist(services: Service[]) {
  await taurus.saveDay({ date: date.value, km: dayKm(services, extraKm.value ?? 0), note: note.value || undefined, services })
  await load() // trae los ids asignados a servicios nuevos
  cashKey.value++
}

async function saveTrip() {
  attempted.value = true
  if (Object.keys(errors.value).length > 0) {
    show('Revisa los campos marcados', 'error')
    return
  }
  const f = form.value
  const trip: Service = {
    id: f.id,
    amount: f.amount as number,
    bonus: typeof f.bonus === 'number' && f.bonus > 0 ? f.bonus : undefined,
    method: f.method,
    startTime: f.startTime,
    endTime: f.endTime,
    distanceKm: f.distanceKm as number,
    origin: f.origin.trim() || undefined,
    destination: f.destination.trim() || undefined,
  }
  saving.value = true
  try {
    const editing = !!f.id
    await persist(upsertTrip(trips.value, trip))
    show(editing ? 'Viaje actualizado' : 'Viaje guardado')
    resetForm()
  } catch (e) {
    show(errorText(e, 'No se pudo guardar'), 'error')
  } finally {
    saving.value = false
  }
}

function edit(x: Service) {
  form.value = {
    id: x.id,
    startTime: x.startTime ?? '',
    endTime: x.endTime ?? '',
    distanceKm: x.distanceKm ?? null,
    amount: x.amount,
    bonus: x.bonus ?? null,
    method: x.method ?? 'cash',
    origin: x.origin ?? '',
    destination: x.destination ?? '',
  }
  attempted.value = false
  nextTick(() => firstField.value?.focus())
}

async function removeOne(x: Service) {
  if (!x.id) return
  if (confirming.value !== x.id) {
    confirming.value = x.id
    const id = x.id
    setTimeout(() => confirming.value === id && (confirming.value = null), 2500)
    return
  }
  try {
    const wasEditing = form.value.id === x.id
    await persist(removeTrip(trips.value, x.id))
    show('Viaje eliminado')
    if (wasEditing) resetForm()
  } catch (e) {
    show(errorText(e, 'No se pudo eliminar'), 'error')
  }
}

// Km y nota del día se guardan al cambiar (si el día ya tiene viajes o datos).
async function saveMeta() {
  if (!taurus || (!trips.value.length && !extraKm.value && !note.value)) return
  try {
    await taurus.saveDay({ date: date.value, km: totalKm.value, note: note.value || undefined, services: trips.value })
    cashKey.value++
  } catch (e) {
    show(errorText(e, 'No se pudo guardar'), 'error')
  }
}
</script>

<template>
  <section class="day-grid rise">
    <!-- Columna izquierda: día y formulario de viaje -->
    <div class="stack">
      <div class="card stack">
        <div class="grid2">
          <label class="field">
            <span>Fecha</span>
            <div class="input-icon">
              <CalendarDays :size="18" />
              <input v-model="date" type="date" class="input">
            </div>
          </label>
          <label class="field">
            <span>Km extra (fuera de viajes)</span>
            <div class="input-icon">
              <Route :size="18" />
              <input v-model.number="extraKm" type="number" inputmode="decimal" min="0" step="any" placeholder="0" class="input" @change="saveMeta">
            </div>
          </label>
        </div>
        <span class="small muted">Km del día: <b class="num">{{ totals.km }}</b> km = viajes {{ tripKm }} + extra {{ extraKm ?? 0 }}</span>
        <label class="field">
          <span>Nota</span>
          <div class="input-icon">
            <NotebookPen :size="18" />
            <input v-model="note" type="text" placeholder="Opcional" class="input" @change="saveMeta">
          </div>
        </label>
      </div>

      <form class="card stack" novalidate @submit.prevent="saveTrip">
        <div class="row between">
          <span class="title">{{ form.id ? 'Editar viaje' : 'Nuevo viaje' }}</span>
          <button v-if="form.id" type="button" class="btn ghost small-btn" @click="resetForm"><X :size="16" /> Cancelar edición</button>
        </div>

        <div class="grid2">
          <label class="field">
            <span>Recogida</span>
            <input ref="firstField" v-model="form.startTime" type="time" class="input" :aria-invalid="!!showErr('startTime')">
            <small v-if="showErr('startTime')" class="err" role="alert">{{ showErr('startTime') }}</small>
          </label>
          <label class="field">
            <span>Llegada</span>
            <input v-model="form.endTime" type="time" class="input" :aria-invalid="!!showErr('endTime')">
            <small v-if="showErr('endTime')" class="err" role="alert">{{ showErr('endTime') }}</small>
          </label>
        </div>
        <div class="grid2">
          <label class="field">
            <span>Duración</span>
            <div class="input-icon">
              <Clock :size="18" />
              <input :value="duration" class="input" readonly tabindex="-1" placeholder="—" aria-label="Duración calculada">
            </div>
          </label>
          <label class="field">
            <span>Distancia (km)</span>
            <div class="input-icon">
              <Route :size="18" />
              <input v-model.number="form.distanceKm" type="number" inputmode="decimal" min="0" step="any" placeholder="0" class="input" :aria-invalid="!!showErr('distanceKm')">
            </div>
            <small v-if="showErr('distanceKm')" class="err" role="alert">{{ showErr('distanceKm') }}</small>
          </label>
        </div>

        <div class="row" style="align-items: flex-start">
          <label class="field grow">
            <span>Dinero</span>
            <div class="input-icon">
              <component :is="form.method === 'cash' ? Banknote : ArrowLeftRight" :size="18" />
              <input v-model.number="form.amount" type="number" inputmode="decimal" min="0" step="any" placeholder="Monto" class="input" :aria-invalid="!!showErr('amount')">
            </div>
            <small v-if="showErr('amount')" class="err" role="alert">{{ showErr('amount') }}</small>
          </label>
          <button type="button" class="chip method" :class="form.method" @click="form.method = form.method === 'cash' ? 'transfer' : 'cash'">
            {{ form.method === 'cash' ? 'Efectivo' : 'Transferencia' }}
          </button>
        </div>

        <label class="field">
          <span>Bonus / propina (opcional)</span>
          <div class="input-icon">
            <Gift :size="18" />
            <input v-model.number="form.bonus" type="number" inputmode="decimal" min="0" step="any" placeholder="0" class="input" :aria-invalid="!!showErr('bonus')">
          </div>
          <small v-if="showErr('bonus')" class="err" role="alert">{{ showErr('bonus') }}</small>
        </label>

        <div class="grid2">
          <label class="field">
            <span>Origen (opcional)</span>
            <div class="input-icon">
              <MapPin :size="18" />
              <input v-model="form.origin" type="text" class="input" placeholder="Origen">
            </div>
          </label>
          <label class="field">
            <span>Destino (opcional)</span>
            <div class="input-icon">
              <MapPin :size="18" />
              <input v-model="form.destination" type="text" class="input" placeholder="Destino">
            </div>
          </label>
        </div>

        <button type="submit" class="btn primary block big" :disabled="saving">
          <Check :size="20" /> {{ form.id ? 'Guardar cambios' : 'Guardar viaje' }}
        </button>
      </form>
    </div>

    <!-- Columna central: neto, costos y caja del día -->
    <div class="stack">
      <div class="hero card">
        <div class="row between">
          <span class="hero-label"><component :is="totals.net >= 0 ? TrendingUp : TrendingDown" :size="16" /> Neto del día</span>
          <span v-if="totals.gross > 0" class="badge" :class="totals.net >= 0 ? 'open' : 'closed'">{{ margin }}% de margen</span>
        </div>
        <p class="hero-value" :class="totals.net < 0 ? 'neg' : ''"><AnimatedNumber :value="totals.net" /></p>
        <div class="hero-meta">
          <div><span>Viajes</span><b class="num">{{ totals.count }}</b></div>
          <div><span>Km</span><b class="num">{{ totals.km }}</b></div>
          <div><span>Bruto</span><b><AnimatedNumber :value="totals.gross" /></b></div>
          <div v-if="totals.bonus > 0"><span>Bonus</span><b><AnimatedNumber :value="totals.bonus" /></b></div>
          <div><span>Costos</span><b><AnimatedNumber :value="totals.totalCost" /></b></div>
        </div>
      </div>

      <div class="card stack" style="gap: 12px">
        <span class="title">Apartar para costos</span>
        <div v-for="c in result.costs" :key="c.categoryId" class="cost">
          <div class="row">
            <span class="icon-tile info"><component :is="categoryIcon(c.name)" :size="20" /></span>
            <div class="grow">
              <div class="row between"><b>{{ c.name }}</b><b class="num">− {{ money(c.amount) }}</b></div>
              <span class="muted small">{{ rate(c.rate) }}</span>
            </div>
          </div>
          <div class="bar"><i :style="{ width: costShare(c.amount) + '%' }" /></div>
        </div>
        <p v-if="!result.costs.length" class="muted small">No hay categorías de costo activas.</p>
      </div>

      <CashPanel :date="date" :refresh-key="cashKey" />
    </div>

    <!-- Columna derecha: viajes del día -->
    <div class="stack">
      <div class="card stack" style="gap: 10px">
        <span class="title">Viajes del día</span>
        <p v-if="!sorted.length" class="muted small">Aún no hay viajes en este día.</p>
        <TransitionGroup v-else name="list" tag="ul" class="trip-list rel">
          <li v-for="(x, i) in sorted" :key="x.id ?? i" class="trip" :class="{ active: form.id && form.id === x.id }">
            <div class="grow">
              <div class="row between">
                <b class="small">
                  <template v-if="tripSummary(x).schedule">{{ tripSummary(x).schedule }}</template>
                  <template v-else>Servicio</template>
                  <span v-if="tripSummary(x).duration" class="muted"> · {{ tripSummary(x).duration }}</span>
                </b>
                <b class="num">{{ money(x.amount) }}</b>
              </div>
              <p v-if="(x.bonus ?? 0) > 0" class="muted small">+ {{ money(x.bonus!) }} bonus</p>
              <p class="muted small">
                <template v-if="x.distanceKm !== undefined">{{ x.distanceKm }} km · </template>{{ x.method === 'transfer' ? 'Transferencia' : 'Efectivo' }}
              </p>
              <p v-if="tripSummary(x).route" class="muted small">{{ tripSummary(x).route }}</p>
            </div>
            <button type="button" class="btn icon ghost" aria-label="Editar viaje" @click="edit(x)"><Pencil :size="18" /></button>
            <button type="button" class="btn icon ghost" :class="{ danger: confirming === x.id }" :aria-label="confirming === x.id ? 'Confirmar eliminación' : 'Eliminar viaje'" @click="removeOne(x)">
              <Trash2 :size="18" />
            </button>
          </li>
        </TransitionGroup>
      </div>
    </div>
  </section>
</template>

<style scoped>
.day-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
@media (min-width: 1000px) { .day-grid { grid-template-columns: minmax(380px, 5fr) minmax(0, 6fr); gap: 20px; } }
@media (min-width: 1400px) { .day-grid { grid-template-columns: minmax(340px, 4fr) minmax(0, 4fr) minmax(300px, 3fr); } }
.rel { position: relative; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.method { margin-top: 24px; }
.small-btn { padding: 6px 10px; font-size: 13px; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
.input[aria-invalid='true'] { border-color: var(--neg); }
.trip-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.trip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border-radius: 14px; padding: 10px 8px 10px 14px; border: 1px solid transparent; transition: border-color 0.2s; }
.trip.active { border-color: var(--accent); }
.hero {
  background: linear-gradient(145deg, var(--surface) 0%, var(--surface-2) 100%);
  position: relative; overflow: hidden;
}
.hero::before {
  content: ''; position: absolute; width: 240px; height: 240px; right: -70px; top: -90px;
  background: radial-gradient(circle, var(--accent-soft), transparent 70%);
}
.hero-label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-weight: 600; font-size: 14px; }
.hero-value { font-size: 44px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin: 8px 0 14px; color: var(--pos); position: relative; }
.hero-value.neg { color: var(--neg); }
.hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; position: relative; }
.hero-meta > div { background: var(--surface-2); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; }
.hero-meta span { font-size: 12px; color: var(--muted); font-weight: 500; }
.hero-meta b { font-size: 15px; }
.cost .bar { height: 6px; border-radius: 99px; background: var(--surface-2); margin-top: 10px; overflow: hidden; }
.cost .bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.6s var(--ease); }
.big { padding: 14px; font-size: 16px; border-radius: 14px; }
.btn:disabled { opacity: 0.6; pointer-events: none; }
</style>
