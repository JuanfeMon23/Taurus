<script setup lang="ts">
import { computeDay, type Category } from '../utils/calc'
import { dayKm, dayTotals, extraKmFrom, removeTrip, sortTrips, tripSummary, upsertTrip } from '../utils/dayTrips'
import { computeCommission, DEFAULT_RATES, type CommissionRates } from '../utils/commission'
import { money, rate, todayISO } from '../utils/format'
import { entryName, methodAffectsCash } from '../utils/catalogs'
import { GENERIC_ERROR, toUserMessage } from '../utils/errors'
import { categoryIcon, methodIcon } from '../utils/icons'
import { formatDuration, sumDistance, tripMinutes, tripTotal, validateTrip, type TripErrors } from '../utils/trip'
import { dayActivity } from '../utils/activity'
import { activeShiftTemplates, activityNow, buildShiftFromTemplate, defaultTripShiftId, loadLastShiftTemplateId, saveLastShiftTemplateId, shiftForTemplate, chipRangeLabel, shiftRemovalBlock, tripsOfShift, clockNow } from '../utils/shifts'
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
  shiftId: string // obligatorio; '' solo mientras no se elige (viaje viejo sin turno)
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
const form = ref<Form>(blank())
const categories = ref<Category[]>([])
const rates = ref<CommissionRates>({ ...DEFAULT_RATES })
const saving = ref(false)
const cashKey = ref(0) // se incrementa al cambiar los viajes para recargar la caja
const attempted = ref(false)
const confirming = ref<string | null>(null)
const firstField = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const { show } = useNotify()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const errorText = (error: unknown, fallback: string) => (toUserMessage(error) === GENERIC_ERROR ? fallback : toUserMessage(error))

function resetForm() {
  shiftTouched.value = false
  form.value = blank()
  attempted.value = false
  nextTick(() => firstField.value?.inputRef?.focus())
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
const shiftChoiceValid = (shiftId: string) => !!shiftId && shifts.value.some(shift => shift.id === shiftId)
const chipRange = (name: string, range: string) => chipRangeLabel(name, range)

// Al cambiar los turnos del día, un viaje nuevo recalcula su turno por defecto si el elegido ya no existe o aún no se tocó.
const shiftTouched = ref(false)
function syncFormShift() {
  if (form.value.id) return
  if (!shiftTouched.value || !shiftChoiceValid(form.value.shiftId)) form.value.shiftId = defaultTripShiftId(shifts.value, loadLastShiftTemplateId(), form.value.startTime)
}
// Con varios turnos y sin plantilla recordada, la hora de recogida escrita orienta el turno mientras no se elija a mano.
watch(() => form.value.startTime, syncFormShift)
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
      const blocked = shiftRemovalBlock(trips.value, existing.id)
      if (blocked) {
        show(blocked, 'error')
        return
      }
      shiftBusy.value = true
      await taurus.repo.deleteShift(existing.id)
      show(`${chip.name} quitado del día`)
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
const methodTone = (methodId?: string) => (methodAffectsCash(catalogs.value.paymentMethods, methodId ?? defaultMethod.value) ? 'success' : 'info')

const tripKm = computed(() => sumDistance(trips.value))
const duration = computed(() => formatDuration(tripMinutes(form.value.startTime, form.value.endTime)))
// Vista previa en vivo; al guardar se calcula con las tasas vigentes y queda fija en el viaje.
const preview = computed(() => computeCommission(typeof form.value.amount === 'number' ? form.value.amount : 0, form.value.isIndrive, rates.value))
const errors = computed<TripErrors>(() => validateTrip({ ...form.value, shiftId: shiftChoiceValid(form.value.shiftId) ? form.value.shiftId : '' }))
const tripsWithoutShift = computed(() => trips.value.filter(trip => !trip.shiftId).length)
const showErr = (field: keyof TripErrors) => (attempted.value ? errors.value[field] : undefined)
const commissionText = computed(() => (form.value.isIndrive ? `Comisión ${money(preview.value.commission)} + IVA ${money(preview.value.commissionVat)}` : 'Viaje propio: sin comisión.'))

async function persist(services: Service[]) {
  await taurus.saveDay({ date: date.value, km: dayKm(services, extraKm.value ?? 0), note: note.value || undefined, services })
  await load() // trae los ids asignados a servicios nuevos
  cashKey.value++
}

async function saveTrip() {
  attempted.value = true
  if (!shifts.value.length) {
    show('Marca un turno del día arriba para registrar viajes', 'error')
    return
  }
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
    shiftId: formValues.shiftId,
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
  nextTick(() => firstField.value?.inputRef?.focus())
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
  <section class="day rise">
    <!-- Barra del día: fecha, km extra, nota y turnos -->
    <div class="day-bar">
      <UFormField label="Fecha" class="w-44">
        <UInput v-model="date" type="date" icon="i-lucide-calendar-days" class="w-full" />
      </UFormField>
      <UFormField label="Km extra (fuera de viajes)" class="w-56">
        <UInput v-model.nullable="extraKm" type="number" inputmode="decimal" min="0" step="any" placeholder="0" icon="i-lucide-route" class="w-full" @change="saveMeta" />
      </UFormField>
      <UFormField label="Nota" class="w-56">
        <UInput v-model="note" type="text" placeholder="Opcional" icon="i-lucide-notebook-pen" class="w-full" @change="saveMeta" />
      </UFormField>
      <UFormField label="Turnos del día" class="min-w-0 flex-1">
        <div v-if="shiftChips.length" class="flex flex-wrap gap-1.5" role="group" aria-label="Turnos del día">
          <UButton v-for="chip in shiftChips" :key="chip.key" size="sm" :color="chip.shift ? 'primary' : 'neutral'" :variant="chip.shift ? 'subtle' : 'outline'"
            :icon="chip.shift ? 'i-lucide-check' : 'i-lucide-plus'" :title="`${chip.name} ${chip.range}`" :aria-pressed="!!chip.shift" :disabled="shiftBusy"
            :data-template="chip.template?.id" :data-shift="chip.shift?.id" @click="toggleShiftChip(chip)">
            <b>{{ chip.name }}</b> <span v-if="chipRange(chip.name, chip.range)" class="num font-normal">{{ chipRange(chip.name, chip.range) }}</span>
          </UButton>
        </div>
        <p v-else class="text-sm text-muted">Registra tus turnos habituales en Tarifas para marcarlos aquí con un toque.</p>
      </UFormField>
    </div>

    <div class="day-grid">
      <!-- Formulario de viaje -->
      <UCard as="form" class="day-form" :ui="{ body: 'p-4 sm:p-4' }" novalidate @submit.prevent="saveTrip">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="panel-title">{{ form.id ? 'Editar viaje' : 'Nuevo viaje' }}</h2>
            <UButton v-if="form.id" type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="resetForm">Cancelar edición</UButton>
          </div>

          <UFormField label="Turno" required :error="shifts.length ? showErr('shiftId') : undefined">
            <div v-if="shifts.length" class="flex flex-wrap gap-1.5" role="group" aria-label="Turno del viaje">
              <UButton v-for="shift in shifts" :key="shift.id" type="button" size="sm" :color="form.shiftId === shift.id ? 'primary' : 'neutral'" :variant="form.shiftId === shift.id ? 'solid' : 'outline'"
                :title="`${shiftName(shift)} ${shiftRange(shift)}`" :aria-pressed="form.shiftId === shift.id" :data-trip-shift="shift.id" @click="pickShift(shift.id)">
                <b>{{ shiftName(shift) }}</b> <span v-if="chipRange(shiftName(shift), shiftRange(shift))" class="num font-normal">{{ chipRange(shiftName(shift), shiftRange(shift)) }}</span>
              </UButton>
            </div>
            <UAlert v-else color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Marca un turno del día arriba para registrar viajes" role="status" />
          </UFormField>

          <div class="grid grid-cols-3 gap-2">
            <UFormField label="Recogida" required :error="showErr('startTime')">
              <UInput ref="firstField" v-model="form.startTime" type="time" class="w-full" />
            </UFormField>
            <UFormField label="Llegada" required :error="showErr('endTime')" :hint="duration || undefined">
              <UInput v-model="form.endTime" type="time" class="w-full" />
            </UFormField>
            <UFormField label="Distancia (km)" required :error="showErr('distanceKm')">
              <UInput v-model.nullable="form.distanceKm" type="number" inputmode="decimal" min="0" step="any" placeholder="0" class="w-full" />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <UFormField label="Dinero" required :error="showErr('amount')">
              <UInput v-model.nullable="form.amount" type="number" inputmode="decimal" min="0" step="any" placeholder="Monto" class="w-full">
                <template #leading>
                  <component :is="methodIcon(form.method, methodAffectsCash(catalogs.paymentMethods, form.method))" :size="16" class="text-dimmed" />
                </template>
              </UInput>
            </UFormField>
            <UFormField label="Bonus / propina (opcional)" :error="showErr('bonus')">
              <UInput v-model.nullable="form.bonus" type="number" inputmode="decimal" min="0" step="any" placeholder="0" icon="i-lucide-gift" class="w-full" />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 items-start gap-2">
            <UFormField label="Medio de pago">
              <UFieldGroup role="group" aria-label="Medio de pago">
                <UButton v-for="method in methodChoices" :key="method.id" type="button" size="sm" :color="form.method === method.id ? methodTone(method.id) : 'neutral'" :variant="form.method === method.id ? 'subtle' : 'outline'"
                  :aria-pressed="form.method === method.id" :data-method="method.id" @click="form.method = method.id">
                  {{ method.name }}
                </UButton>
              </UFieldGroup>
            </UFormField>
            <UCheckbox v-model="form.isIndrive" label="Viaje inDrive" :description="commissionText" class="num pt-5" aria-live="polite" />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <UFormField label="Origen (opcional)">
              <UInput v-model="form.origin" type="text" placeholder="Origen" icon="i-lucide-map-pin" class="w-full" />
            </UFormField>
            <UFormField label="Destino (opcional)">
              <UInput v-model="form.destination" type="text" placeholder="Destino" icon="i-lucide-map-pin" class="w-full" />
            </UFormField>
          </div>

          <UButton type="submit" block size="lg" icon="i-lucide-check" :loading="saving" :disabled="saving || !shifts.length">
            {{ form.id ? 'Guardar cambios' : 'Guardar viaje' }}
          </UButton>
        </div>
      </UCard>

      <!-- Resumen del día y caja -->
      <div class="flex min-w-0 flex-col gap-3">
        <UCard :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center justify-between gap-2">
            <span class="panel-title flex items-center gap-1.5">
              <UIcon :name="totals.net >= 0 ? 'i-lucide-trending-up' : 'i-lucide-trending-down'" class="size-4" /> Neto del día
            </span>
            <UBadge v-if="totals.gross > 0" :color="totals.net >= 0 ? 'success' : 'neutral'" variant="subtle">{{ margin }}% de margen</UBadge>
          </div>
          <p class="net num" :class="totals.net < 0 ? 'text-error' : 'text-success'"><AnimatedNumber :value="totals.net" /></p>
          <dl class="stats">
            <div><dt>Viajes</dt><dd class="num">{{ totals.count }}</dd></div>
            <div><dt>Km</dt><dd class="num" :title="`Km del día = viajes ${tripKm} + extra ${extraKm ?? 0}`">{{ totals.km }}<span v-if="extraKm" class="extra"> (+{{ extraKm }} extra)</span></dd></div>
            <div><dt>Bruto</dt><dd><AnimatedNumber :value="totals.gross" /></dd></div>
            <div v-if="totals.bonus > 0"><dt>Bonus</dt><dd><AnimatedNumber :value="totals.bonus" /></dd></div>
            <div><dt>Costos</dt><dd><AnimatedNumber :value="totals.totalCost" /></dd></div>
            <div v-if="totals.commission + totals.commissionVat > 0"><dt>Comisión inDrive</dt><dd><AnimatedNumber :value="totals.commission + totals.commissionVat" /></dd></div>
          </dl>

          <USeparator class="my-3" />

          <h2 class="panel-title mb-2">Apartar para costos</h2>
          <ul class="flex flex-col gap-2.5">
            <li v-for="costLine in result.costs" :key="costLine.categoryId">
              <div class="flex items-center gap-2.5">
                <span class="icon-tile info !size-8 !rounded-lg"><component :is="categoryIcon(costLine.name)" :size="16" /></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-sm font-semibold text-highlighted">{{ costLine.name }} <span class="font-normal text-muted">· {{ rate(costLine.rate) }}</span></span>
                    <span class="num text-sm font-bold text-highlighted">− {{ money(costLine.amount) }}</span>
                  </div>
                  <UProgress :model-value="costShare(costLine.amount)" size="xs" class="mt-1.5" aria-hidden="true" />
                </div>
              </div>
            </li>
          </ul>
          <p v-if="!result.costs.length" class="text-sm text-muted">No hay categorías de costo activas.</p>
        </UCard>

        <CashPanel :date="date" :refresh-key="cashKey" compact />
      </div>

      <!-- Viajes del día -->
      <div class="trips-col">
        <UCard class="trips-card" :ui="{ root: 'flex flex-col overflow-hidden', body: 'flex min-h-0 flex-1 flex-col gap-2 p-4 sm:p-4' }">
          <div class="flex items-center justify-between gap-2">
            <h2 class="panel-title">Viajes del día</h2>
            <UBadge v-if="sorted.length" color="neutral" variant="subtle" class="num">{{ sorted.length }}</UBadge>
          </div>
          <UAlert v-if="tripsWithoutShift" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Hay viajes de este día sin turno; asígnales uno" role="status" />
          <div v-if="!sorted.length" class="empty-trips">
            <UIcon name="i-lucide-route" class="size-7 opacity-60" />
            <p>Aún no hay viajes en este día.</p>
          </div>
          <TransitionGroup v-else name="list" tag="ul" class="trip-list">
            <li v-for="(trip, index) in sorted" :key="trip.id ?? index" class="trip" :class="{ active: form.id && form.id === trip.id }">
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-sm font-semibold text-highlighted">
                    <template v-if="tripSummary(trip).schedule">{{ tripSummary(trip).schedule }}</template>
                    <template v-else>Servicio</template>
                    <span v-if="tripSummary(trip).duration" class="whitespace-nowrap font-normal text-muted"> · {{ tripSummary(trip).duration }}</span>
                  </span>
                  <span class="num whitespace-nowrap font-bold text-highlighted">{{ money(trip.amount) }}</span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                  <span v-if="trip.distanceKm !== undefined" class="num">{{ trip.distanceKm }} km</span>
                  <UBadge :color="methodTone(trip.method)" variant="subtle" size="sm">{{ entryName(catalogs.paymentMethods, trip.method ?? defaultMethod) }}</UBadge>
                  <UBadge v-if="shiftNameById(trip.shiftId)" color="neutral" variant="outline" size="sm" icon="i-lucide-layers">{{ shiftNameById(trip.shiftId) }}</UBadge>
                  <UBadge v-else color="warning" variant="subtle" size="sm" icon="i-lucide-triangle-alert">Sin turno</UBadge>
                  <UBadge v-if="trip.id && outOfShiftIds.has(trip.id)" color="info" variant="subtle" size="sm">Fuera de turno</UBadge>
                  <span v-if="trip.isIndrive === false">Propio</span>
                </div>
                <p v-if="(trip.bonus ?? 0) > 0 || (trip.isIndrive !== false && (trip.commission ?? 0) > 0) || tripSummary(trip).route" class="num mt-1 text-xs text-muted">
                  <template v-if="(trip.bonus ?? 0) > 0">+ {{ money(trip.bonus!) }} bonus</template>
                  <template v-if="trip.isIndrive !== false && (trip.commission ?? 0) > 0">{{ (trip.bonus ?? 0) > 0 ? ' · ' : '' }}Comisión {{ money(trip.commission!) }} + IVA {{ money(trip.commissionVat ?? 0) }}</template>
                  <template v-if="tripSummary(trip).route">{{ (trip.bonus ?? 0) > 0 || (trip.isIndrive !== false && (trip.commission ?? 0) > 0) ? ' · ' : '' }}{{ tripSummary(trip).route }}</template>
                </p>
              </div>
              <div class="flex shrink-0 flex-col">
                <UButton type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" aria-label="Editar viaje" @click="edit(trip)" />
                <UButton type="button" size="xs" :color="confirming === trip.id ? 'error' : 'neutral'" :variant="confirming === trip.id ? 'subtle' : 'ghost'" icon="i-lucide-trash-2"
                  :aria-label="confirming === trip.id ? 'Confirmar eliminación' : 'Eliminar viaje'" @click="removeOne(trip)" />
              </div>
            </li>
          </TransitionGroup>
        </UCard>
      </div>
    </div>
  </section>
</template>

<style scoped>
.day { display: flex; flex-direction: column; gap: 12px; }
/* Barra del día: una sola franja, sin tarjeta de formulario. */
.day-bar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; padding: 10px 14px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--surface) 70%, transparent); }
.day-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
@media (min-width: 1000px) { .day-grid { grid-template-columns: minmax(380px, 5fr) minmax(0, 6fr); } }
/* En 3 columnas la lista de viajes ocupa exactamente la altura de la fila (la dan formulario y resumen) y hace scroll dentro. */
@media (min-width: 1400px) {
  .day-grid { grid-template-columns: minmax(340px, 4fr) minmax(0, 4fr) minmax(380px, 4fr); align-items: stretch; }
  .trips-col { position: relative; min-height: 320px; }
  .trips-card { position: absolute; inset: 0; }
}
.trips-card { max-height: 70vh; }
@media (min-width: 1400px) { .trips-card { max-height: none; } }
.panel-title { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.net { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin: 6px 0 12px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 6px 12px; margin: 0; }
.stats > div { display: flex; flex-direction: column; min-width: 0; }
.stats dt { font-size: 12px; color: var(--muted); }
.stats dd .extra { font-size: 11px; font-weight: 500; color: var(--muted); }
.stats dd { margin: 0; font-size: 15px; font-weight: 700; color: var(--text); }
.trip-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.trip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border-radius: var(--radius-sm); padding: 8px 6px 8px 12px; border: 1px solid transparent; transition: border-color 0.2s; }
.trip.active { border-color: var(--accent); }
.empty-trips { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; color: var(--muted); font-size: 14px; text-align: center; }
</style>
