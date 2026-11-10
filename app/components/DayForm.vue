<script setup lang="ts">
import { CalendarDays, Check, Clock, Layers, Gift, MapPin, NotebookPen, Pencil, Route, Trash2, TrendingDown, TrendingUp, X } from 'lucide-vue-next'
import { computeDay, type Category } from '../utils/calc'
import { dayKm, dayTotals, extraKmFrom, removeTrip, sortTrips, tripSummary, upsertTrip } from '../utils/dayTrips'
import { computeCommission, DEFAULT_RATES, type CommissionRates } from '../utils/commission'
import { money, rate, todayISO } from '../utils/format'
import { entryName, methodAffectsCash } from '../utils/catalogs'
import { GENERIC_ERROR, toUserMessage } from '../utils/errors'
import { categoryIcon, methodIcon } from '../utils/icons'
import { formatDuration, sumDistance, tripMinutes, tripTotal, validateTrip, type TripErrors } from '../utils/trip'
import { dayActivity } from '../utils/activity'
import { activeShiftTemplates, activityNow, buildShiftFromTemplate, defaultTripShiftId, loadLastShiftTemplateId, saveLastShiftTemplateId, shiftForTemplate, tripsOfShift, unlinkShiftTrips, clockNow } from '../utils/shifts'
import type { Service, Shift, ShiftTemplate } from '../services/types'

// Un solo formulario de viaje; al guardar el viaje queda en el día y el formulario se vacía.
// El id se conserva al editar para que la sincronización reconozca el mismo servicio.
type Form = {
  id?: string
  startTime: string
  endTime: string
  distanceKm: number | null
  amount: number | null
  bonus: number | null
  method: string
  isIndrive: boolean
  origin: string
  destination: string
  shiftId: string // '' = sin turno
}
const { catalogs, activeMethods, defaultMethod, refreshCatalogs } = useCatalogs()
// Medios ofrecidos: los activos y, al editar un viaje, el que ya tenía aunque se haya desactivado.
const methodChoices = computed(() => {
  const current = catalogs.value.paymentMethods.find(method => method.id === form.value.method)
  return current && !current.active ? [...activeMethods.value, current] : activeMethods.value
})
const blank = (): Form => ({ startTime: '', endTime: '', distanceKm: null, amount: null, bonus: null, method: defaultMethod.value, isIndrive: true, origin: '', destination: '', shiftId: defaultTripShiftId(shifts.value, loadLastShiftTemplateId()) })

const date = ref(todayISO())
const extraKm = ref<number | null>(null)
const note = ref('')
const trips = ref<Service[]>([])
const shifts = ref<Shift[]>([])
const templates = ref<ShiftTemplate[]>([])
const shiftBusy = ref(false)
const confirmingShift = ref<string | null>(null)
const form = ref<Form>(blank())
const categories = ref<Category[]>([])
const rates = ref<CommissionRates>({ ...DEFAULT_RATES })
const saving = ref(false)
const cashKey = ref(0) // se incrementa al cambiar los viajes para recargar la caja
const attempted = ref(false)
const confirming = ref<string | null>(null)
const firstField = ref<HTMLInputElement | null>(null)
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const errorText = (error: unknown, fallback: string) => (toUserMessage(error) === GENERIC_ERROR ? fallback : toUserMessage(error))

function resetForm() {
  shiftTouched.value = false
  form.value = blank()
  attempted.value = false
  nextTick(() => firstField.value?.focus())
}

async function load() {
  const existing = await taurus.repo.getDay(date.value)
  trips.value = existing?.services ?? []
  shifts.value = await taurus.repo.listShifts(date.value)
  templates.value = await taurus.repo.listShiftTemplates()
  const extra = existing ? extraKmFrom(existing.km, trips.value) : 0
  extraKm.value = extra > 0 ? extra : null
  note.value = existing?.note ?? ''
  confirming.value = null
  confirmingShift.value = null
  form.value = blank()
  attempted.value = false
}

onMounted(async () => {
  try {
    taurus = await useTaurus()
    categories.value = await taurus.repo.listCategories()
    rates.value = await taurus.repo.getRates()
    await refreshCatalogs()
    await load()
  } catch (error) {
    show(errorText(error, 'No se pudo cargar'), 'error')
  }
})
// KeepAlive: refrescar tarifas si cambiaron en la pestaña Tarifas.
onActivated(async () => {
  if (taurus) {
    categories.value = await taurus.repo.listCategories()
    rates.value = await taurus.repo.getRates()
    await refreshCatalogs()
    templates.value = await taurus.repo.listShiftTemplates()
    if (!form.value.id && !form.value.method) form.value.method = defaultMethod.value
  }
})
watch(date, async () => {
  if (!taurus) return
  try {
    await load()
  } catch (error) {
    show(errorText(error, 'No se pudo cargar'), 'error')
  }
})

// Chips de turnos del día: las plantillas activas (marcadas o no) y los turnos que no corresponden a una plantilla activa (sueltos o de plantillas desactivadas), siempre marcados.
type ShiftChip = { key: string, name: string, range: string, shift?: Shift, template?: ShiftTemplate }
const shiftRange = (shift: Pick<Shift, 'startTime' | 'endTime'>) => `${shift.startTime}–${shift.endTime ?? 'en curso'}`
const shiftName = (shift: Shift) => templates.value.find(template => template.id === shift.templateId)?.name ?? 'Turno suelto'
const shiftChips = computed<ShiftChip[]>(() => {
  const activeTemplates = activeShiftTemplates(templates.value)
  const fromTemplates = activeTemplates.map((template): ShiftChip => {
    const shift = shiftForTemplate(shifts.value, template.id)
    return { key: template.id, name: template.name, range: shift ? shiftRange(shift) : `${template.startTime}–${template.endTime}`, shift, template }
  })
  const activeIds = new Set(activeTemplates.map(template => template.id))
  const others = shifts.value.filter(shift => !shift.templateId || !activeIds.has(shift.templateId))
    .map((shift): ShiftChip => ({ key: shift.id, name: shiftName(shift), range: shiftRange(shift), shift }))
  return [...fromTemplates, ...others]
})
const shiftNameById = (shiftId?: string) => {
  const shift = shiftId ? shifts.value.find(candidate => candidate.id === shiftId) : undefined
  return shift ? `${shiftName(shift)} ${shiftRange(shift)}` : ''
}
const shiftChoiceValid = (shiftId: string) => !shiftId || shifts.value.some(shift => shift.id === shiftId)

// Al cambiar los turnos del día, un viaje nuevo recalcula su turno por defecto si el elegido ya no existe o aún no se tocó.
const shiftTouched = ref(false)
function syncFormShift() {
  if (form.value.id) return
  if (!shiftTouched.value || !shiftChoiceValid(form.value.shiftId)) form.value.shiftId = defaultTripShiftId(shifts.value, loadLastShiftTemplateId())
}
function pickShift(shiftId: string) {
  form.value.shiftId = shiftId
  shiftTouched.value = true
}

async function toggleShiftChip(chip: ShiftChip) {
  if (shiftBusy.value) return
  const existing = chip.shift
  try {
    if (!existing) {
      shiftBusy.value = true
      await taurus.repo.saveShift(buildShiftFromTemplate(chip.template!, date.value))
      show(`${chip.name} agregado al día`)
    } else {
      const linked = tripsOfShift(trips.value, existing.id)
      if (linked.length && confirmingShift.value !== existing.id) {
        confirmingShift.value = existing.id
        setTimeout(() => confirmingShift.value === existing.id && (confirmingShift.value = null), 2500)
        return
      }
      shiftBusy.value = true
      // Primero se desligan los viajes: el servidor rechaza viajes que apunten a un turno inexistente.
      if (linked.length) await taurus.saveDay({ date: date.value, km: totalKm.value, note: note.value || undefined, services: unlinkShiftTrips(trips.value, existing.id) })
      await taurus.repo.deleteShift(existing.id)
      show(linked.length ? `${chip.name} quitado; ${linked.length} ${linked.length === 1 ? 'viaje quedó' : 'viajes quedaron'} sin turno` : `${chip.name} quitado del día`)
    }
    const editingId = form.value.id
    const draft = { ...form.value }
    await load()
    if (editingId) form.value = { ...draft, shiftId: shiftChoiceValid(draft.shiftId) ? draft.shiftId : '' }
    else syncFormShift()
    cashKey.value++
  } catch (error) {
    show(`No se pudo cambiar el turno: ${errorText(error, 'error al guardar')}`, 'error')
  } finally {
    shiftBusy.value = false
  }
}

const sorted = computed(() => sortTrips(trips.value))
// Viajes total o parcialmente fuera de turno (solo si el día tiene turnos); el turno en curso cuenta hasta ahora en el día de hoy.
const outOfShiftIds = computed(() => new Set(dayActivity(trips.value, shifts.value, activityNow(date.value, todayISO(), clockNow())).outOfShiftTrips))
const totalKm = computed(() => dayKm(trips.value, extraKm.value ?? 0))
const totals = computed(() => dayTotals(trips.value, totalKm.value, categories.value, catalogs.value.rateModes))
const result = computed(() => computeDay({ services: trips.value.map(tripTotal), km: totalKm.value, categories: categories.value, rateModes: catalogs.value.rateModes }))
const costShare = (amount: number) => (result.value.totalCost > 0 ? Math.max((amount / result.value.totalCost) * 100, 4) : 0)
const margin = computed(() => (totals.value.gross > 0 ? Math.round((totals.value.net / totals.value.gross) * 100) : 0))

const tripKm = computed(() => sumDistance(trips.value))
const duration = computed(() => formatDuration(tripMinutes(form.value.startTime, form.value.endTime)))
// Vista previa en vivo; al guardar se calcula con las tasas vigentes y queda fija en el viaje.
const preview = computed(() => computeCommission(typeof form.value.amount === 'number' ? form.value.amount : 0, form.value.isIndrive, rates.value))
const errors = computed<TripErrors>(() => validateTrip(form.value))
const showErr = (field: keyof TripErrors) => (attempted.value ? errors.value[field] : undefined)

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
  const formValues = form.value
  const trip: Service = {
    id: formValues.id,
    amount: formValues.amount as number,
    bonus: typeof formValues.bonus === 'number' && formValues.bonus > 0 ? formValues.bonus : undefined,
    method: formValues.method,
    isIndrive: formValues.isIndrive,
    ...computeCommission(formValues.amount as number, formValues.isIndrive, rates.value),
    startTime: formValues.startTime,
    endTime: formValues.endTime,
    distanceKm: formValues.distanceKm as number,
    origin: formValues.origin.trim() || undefined,
    destination: formValues.destination.trim() || undefined,
    shiftId: formValues.shiftId || undefined,
  }
  saving.value = true
  try {
    const editing = !!formValues.id
    const chosenShift = shifts.value.find(shift => shift.id === formValues.shiftId)
    if (chosenShift?.templateId) saveLastShiftTemplateId(chosenShift.templateId)
    await persist(upsertTrip(trips.value, trip))
    show(editing ? 'Viaje actualizado' : 'Viaje guardado')
    resetForm()
  } catch (error) {
    show(errorText(error, 'No se pudo guardar'), 'error')
  } finally {
    saving.value = false
  }
}

function edit(trip: Service) {
  form.value = {
    id: trip.id,
    startTime: trip.startTime ?? '',
    endTime: trip.endTime ?? '',
    distanceKm: trip.distanceKm ?? null,
    amount: trip.amount,
    bonus: trip.bonus ?? null,
    method: trip.method ?? defaultMethod.value,
    isIndrive: trip.isIndrive !== false,
    origin: trip.origin ?? '',
    destination: trip.destination ?? '',
    shiftId: trip.shiftId && shiftChoiceValid(trip.shiftId) ? trip.shiftId : '',
  }
  attempted.value = false
  nextTick(() => firstField.value?.focus())
}

async function removeOne(trip: Service) {
  if (!trip.id) return
  if (confirming.value !== trip.id) {
    confirming.value = trip.id
    const id = trip.id
    setTimeout(() => confirming.value === id && (confirming.value = null), 2500)
    return
  }
  try {
    const wasEditing = form.value.id === trip.id
    await persist(removeTrip(trips.value, trip.id))
    show('Viaje eliminado')
    if (wasEditing) resetForm()
  } catch (error) {
    show(errorText(error, 'No se pudo eliminar'), 'error')
  }
}

// Km y nota del día se guardan al cambiar (si el día ya tiene viajes o datos).
async function saveMeta() {
  if (!taurus || (!trips.value.length && !extraKm.value && !note.value)) return
  try {
    await taurus.saveDay({ date: date.value, km: totalKm.value, note: note.value || undefined, services: trips.value })
    cashKey.value++
  } catch (error) {
    show(errorText(error, 'No se pudo guardar'), 'error')
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
        <div class="field">
          <span>Turnos</span>
          <div v-if="shiftChips.length" class="shift-chips" role="group" aria-label="Turnos del día">
            <button v-for="chip in shiftChips" :key="chip.key" type="button" class="chip shift-chip" :class="{ on: !!chip.shift, confirm: !!chip.shift && confirmingShift === chip.shift.id }"
              :aria-pressed="!!chip.shift" :disabled="shiftBusy" :data-template="chip.template?.id" :data-shift="chip.shift?.id" @click="toggleShiftChip(chip)">
              <template v-if="chip.shift && confirmingShift === chip.shift.id">Quitar: {{ tripsOfShift(trips, chip.shift.id).length }} viaje(s) quedarán sin turno. Toca otra vez</template>
              <template v-else><b>{{ chip.name }}</b> <span class="num">{{ chip.range }}</span></template>
            </button>
          </div>
          <p v-else class="muted small">Registra tus turnos habituales en Tarifas para marcarlos aquí con un toque.</p>
        </div>
      </div>

      <form class="card stack" novalidate @submit.prevent="saveTrip">
        <div class="row between">
          <span class="title">{{ form.id ? 'Editar viaje' : 'Nuevo viaje' }}</span>
          <button v-if="form.id" type="button" class="btn ghost small-btn" @click="resetForm"><X :size="16" /> Cancelar edición</button>
        </div>

        <div v-if="shifts.length" class="field">
          <span>Turno</span>
          <div class="shift-chips" role="group" aria-label="Turno del viaje">
            <button type="button" class="chip shift-chip" :class="{ on: !form.shiftId }" :aria-pressed="!form.shiftId" data-trip-shift="" @click="pickShift('')">Sin turno</button>
            <button v-for="shift in shifts" :key="shift.id" type="button" class="chip shift-chip" :class="{ on: form.shiftId === shift.id }"
              :aria-pressed="form.shiftId === shift.id" :data-trip-shift="shift.id" @click="pickShift(shift.id)">
              <b>{{ shiftName(shift) }}</b> <span class="num">{{ shiftRange(shift) }}</span>
            </button>
          </div>
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
              <component :is="methodIcon(form.method, methodAffectsCash(catalogs.paymentMethods, form.method))" :size="18" />
              <input v-model.number="form.amount" type="number" inputmode="decimal" min="0" step="any" placeholder="Monto" class="input" :aria-invalid="!!showErr('amount')">
            </div>
            <small v-if="showErr('amount')" class="err" role="alert">{{ showErr('amount') }}</small>
          </label>
          <div class="methods" role="group" aria-label="Medio de pago">
            <button v-for="method in methodChoices" :key="method.id" type="button" class="chip method" :class="method.affectsCash ? 'pos' : 'info'"
              :aria-pressed="form.method === method.id" :data-method="method.id" @click="form.method = method.id">
              {{ method.name }}
            </button>
          </div>
        </div>

        <label class="check">
          <input v-model="form.isIndrive" type="checkbox">
          <span>Viaje inDrive</span>
        </label>
        <p v-if="form.isIndrive" class="muted small num" aria-live="polite">Comisión {{ money(preview.commission) }} + IVA {{ money(preview.commissionVat) }}</p>
        <p v-else class="muted small">Viaje propio: sin comisión.</p>

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
          <div v-if="totals.commission + totals.commissionVat > 0"><span>Comisión inDrive</span><b><AnimatedNumber :value="totals.commission + totals.commissionVat" /></b></div>
        </div>
      </div>

      <div class="card stack" style="gap: 12px">
        <span class="title">Apartar para costos</span>
        <div v-for="costLine in result.costs" :key="costLine.categoryId" class="cost">
          <div class="row">
            <span class="icon-tile info"><component :is="categoryIcon(costLine.name)" :size="20" /></span>
            <div class="grow">
              <div class="row between"><b>{{ costLine.name }}</b><b class="num">− {{ money(costLine.amount) }}</b></div>
              <span class="muted small">{{ rate(costLine.rate) }}</span>
            </div>
          </div>
          <div class="bar"><i :style="{ width: costShare(costLine.amount) + '%' }" /></div>
        </div>
        <p v-if="!result.costs.length" class="muted small">No hay categorías de costo activas.</p>
      </div>

      <CashPanel :date="date" :refresh-key="cashKey" compact />
    </div>

    <!-- Columna derecha: viajes del día -->
    <div class="stack trips-col">
      <div class="card stack trips-card" style="gap: 10px">
        <span class="title">Viajes del día</span>
        <p v-if="!sorted.length" class="muted small">Aún no hay viajes en este día.</p>
        <TransitionGroup v-else name="list" tag="ul" class="trip-list trip-scroll rel">
          <li v-for="(trip, i) in sorted" :key="trip.id ?? i" class="trip" :class="{ active: form.id && form.id === trip.id }">
            <div class="grow">
              <div class="row between">
                <b class="small">
                  <template v-if="tripSummary(trip).schedule">{{ tripSummary(trip).schedule }}</template>
                  <template v-else>Servicio</template>
                  <span v-if="tripSummary(trip).duration" class="muted dur"> · {{ tripSummary(trip).duration }}</span>
                </b>
                <b class="num">{{ money(trip.amount) }}</b>
              </div>
              <p v-if="(trip.bonus ?? 0) > 0" class="muted small">+ {{ money(trip.bonus!) }} bonus</p>
              <p class="muted small">
                <template v-if="trip.distanceKm !== undefined">{{ trip.distanceKm }} km · </template>{{ entryName(catalogs.paymentMethods, trip.method ?? defaultMethod) }}
              </p>
              <p v-if="shiftNameById(trip.shiftId)" class="muted small"><Layers :size="12" class="inline-icon" /> {{ shiftNameById(trip.shiftId) }}</p>
              <p v-if="trip.isIndrive === false" class="muted small">Propio</p>
              <p v-else-if="(trip.commission ?? 0) > 0" class="muted small num">Comisión {{ money(trip.commission!) }} + IVA {{ money(trip.commissionVat ?? 0) }}</p>
              <p v-if="tripSummary(trip).route" class="muted small">{{ tripSummary(trip).route }}</p>
              <p v-if="trip.id && outOfShiftIds.has(trip.id)" class="out-of-shift small">fuera de turno</p>
            </div>
            <button type="button" class="btn icon ghost" aria-label="Editar viaje" @click="edit(trip)"><Pencil :size="18" /></button>
            <button type="button" class="btn icon ghost" :class="{ danger: confirming === trip.id }" :aria-label="confirming === trip.id ? 'Confirmar eliminación' : 'Eliminar viaje'" @click="removeOne(trip)">
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
@media (min-width: 1400px) { .day-grid { grid-template-columns: minmax(340px, 4fr) minmax(0, 4fr) minmax(380px, 4fr); } }
.rel { position: relative; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.methods { display: flex; flex-direction: column; gap: 6px; margin-top: 24px; }
.method { justify-content: center; }
.method[aria-pressed='false'] { opacity: 0.45; }
.check { display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; }
.check input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }
.small-btn { padding: 6px 10px; font-size: 13px; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
.input[aria-invalid='true'] { border-color: var(--neg); }
.trip-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
/* La lista hace scroll dentro de su tarjeta; en 3 columnas la tarjeta queda fija arriba y acotada al alto de la ventana. */
.trips-card { display: flex; flex-direction: column; max-height: 70vh; }
.trip-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
@media (min-width: 1400px) {
  .trips-col { align-self: stretch; }
  .trips-card { position: sticky; top: 24px; max-height: calc(100vh - 48px); }
}
.shift-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.shift-chip { background: var(--surface-2); color: var(--text-2); border: 1.5px solid transparent; }
.shift-chip.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.shift-chip.confirm { border-color: var(--neg); color: var(--neg); }
.shift-chip:disabled { opacity: 0.5; pointer-events: none; }
.inline-icon { display: inline; vertical-align: -1px; }
.out-of-shift { color: var(--info); font-weight: 600; }
.trip .row.between > b:first-child { min-width: 0; }
.trip .num, .trip .dur { white-space: nowrap; }
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
