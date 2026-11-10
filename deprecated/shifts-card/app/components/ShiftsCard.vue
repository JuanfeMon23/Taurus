<script setup lang="ts">
import { Copy, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import type { Shift, ShiftTemplate } from '../services/types'
import { toUserMessage } from '../utils/errors'
import { appliedTemplateIds, buildShiftFromTemplate, clockNow, copyClosedShifts, findOpenShift, previousDay, shiftForTemplate, totalShiftMinutes } from '../utils/shifts'
import { formatDuration } from '../utils/trip'
import { validateShiftInput } from '../utils/validation'

/** Turnos del día seleccionado: plantillas como chips (marcar crea el turno, desmarcar lo borra), ajuste de horas, turno suelto, borrado con confirmación y copia de ayer. */
const props = defineProps<{ date: string }>()
const emit = defineEmits<{ change: [shifts: Shift[]] }>()

const shifts = ref<Shift[]>([])
const yesterdayShifts = ref<Shift[]>([])
const templates = ref<ShiftTemplate[]>([])
const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ startTime: '', endTime: '' })
const formError = ref<string | null>(null)
const confirming = ref<string | null>(null)
const busy = ref(false)
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const openShift = computed(() => findOpenShift(shifts.value))
const totalMinutes = computed(() => totalShiftMinutes(shifts.value, clockNow()))
const totalLabel = computed(() => formatDuration(totalMinutes.value) || '0 min')
const applied = computed(() => appliedTemplateIds(shifts.value))
const templateName = (templateId?: string) => templates.value.find(template => template.id === templateId)?.name
const canCopy = computed(() => yesterdayShifts.value.some(shift => shift.endTime) && !shifts.value.length)

async function load() {
  shifts.value = await taurus.repo.listShifts(props.date)
  yesterdayShifts.value = await taurus.repo.listShifts(previousDay(props.date))
  templates.value = await taurus.repo.listShiftTemplates()
  confirming.value = null
  emit('change', shifts.value)
}

async function run(action: () => Promise<void>, failure: string) {
  busy.value = true
  try {
    await action()
    await load()
  } catch (error) {
    show(`${failure}: ${toUserMessage(error)}`, 'error')
  } finally {
    busy.value = false
  }
}

const toggleTemplate = (template: ShiftTemplate) => run(async () => {
  const existing = shiftForTemplate(shifts.value, template.id)
  if (existing) {
    await taurus.repo.deleteShift(existing.id)
    show(`${template.name} quitado del día`)
  } else {
    await taurus.repo.saveShift(buildShiftFromTemplate(template, props.date))
    show(`${template.name} agregado al día`)
  }
}, 'No se pudo cambiar el turno')

const copyYesterday = () => run(async () => {
  for (const copy of copyClosedShifts(yesterdayShifts.value, props.date)) await taurus.repo.saveShift(copy)
  show('Turnos de ayer copiados')
}, 'No se pudieron copiar los turnos')

function openModal(shift?: Shift) {
  editingId.value = shift?.id ?? null
  form.value = { startTime: shift?.startTime ?? '', endTime: shift?.endTime ?? '' }
  formError.value = null
  modalOpen.value = true
}

async function submitModal() {
  formError.value = validateShiftInput(form.value)
  if (formError.value) return
  const previous = shifts.value.find(shift => shift.id === editingId.value)
  await run(async () => {
    await taurus.repo.saveShift({ ...previous, date: props.date, startTime: form.value.startTime, endTime: form.value.endTime || undefined })
    modalOpen.value = false
    show(previous ? 'Turno actualizado' : 'Turno agregado')
  }, 'No se pudo guardar el turno')
}

async function removeOne(shift: Shift) {
  if (confirming.value !== shift.id) {
    confirming.value = shift.id
    setTimeout(() => confirming.value === shift.id && (confirming.value = null), 2500)
    return
  }
  await run(async () => {
    await taurus.repo.deleteShift(shift.id)
    show('Turno eliminado')
  }, 'No se pudo eliminar el turno')
}

onMounted(async () => {
  try {
    taurus = await useTaurus()
    await load()
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
})
watch(() => props.date, async () => {
  if (!taurus) return
  try {
    await load()
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
})
</script>

<template>
  <div class="card stack" style="gap: 10px">
    <div class="row between">
      <span class="title">Turnos del día</span>
      <span v-if="shifts.length" class="badge" :class="openShift ? 'open' : 'closed'">{{ openShift ? 'En curso · ' : '' }}{{ totalLabel }}</span>
    </div>

    <div v-if="templates.length" class="templates" role="group" aria-label="Turnos habituales">
      <button v-for="template in templates" :key="template.id" type="button" class="chip template" :class="{ on: applied.has(template.id) }"
        :aria-pressed="applied.has(template.id)" :disabled="busy" :data-template="template.id" @click="toggleTemplate(template)">
        <b>{{ template.name }}</b> <span class="num">{{ template.startTime }}–{{ template.endTime }}</span>
      </button>
    </div>
    <p v-else class="muted small">Registra tus turnos habituales en Tarifas para aplicarlos aquí con un toque.</p>

    <p v-if="!shifts.length" class="muted small">Sin turnos registrados: las métricas usan primera recogida → última llegada.</p>
    <ul v-else class="shift-list">
      <li v-for="shift in shifts" :key="shift.id" class="shift">
        <b class="num grow">{{ shift.startTime }} – {{ shift.endTime ?? 'en curso' }}<span v-if="templateName(shift.templateId)" class="muted small"> · {{ templateName(shift.templateId) }}</span></b>
        <button type="button" class="btn icon ghost" aria-label="Editar turno" @click="openModal(shift)"><Pencil :size="16" /></button>
        <button type="button" class="btn icon ghost" :class="{ danger: confirming === shift.id }" :aria-label="confirming === shift.id ? 'Confirmar eliminación del turno' : 'Eliminar turno'" @click="removeOne(shift)">
          <Trash2 :size="16" />
        </button>
      </li>
    </ul>

    <div class="shift-actions">
      <button type="button" class="btn ghost" :disabled="busy" @click="openModal()"><Plus :size="16" /> Agregar turno suelto</button>
      <button type="button" class="btn ghost" :disabled="busy || !canCopy" @click="copyYesterday"><Copy :size="16" /> Copiar turnos de ayer</button>
    </div>

    <BaseModal :open="modalOpen" :title="editingId ? 'Editar turno' : 'Agregar turno'" @close="modalOpen = false">
      <form class="stack" novalidate @submit.prevent="submitModal">
        <div class="grid2">
          <label class="field">
            <span>Inicio</span>
            <input v-model="form.startTime" type="time" class="input">
          </label>
          <label class="field">
            <span>Fin</span>
            <input v-model="form.endTime" type="time" class="input">
          </label>
        </div>
        <p class="muted small">Ajusta las horas de este día; la plantilla no cambia. Si el fin es menor que el inicio, cruza la medianoche.</p>
        <small v-if="formError" class="err" role="alert">{{ formError }}</small>
        <div class="row">
          <button type="button" class="btn ghost grow" @click="modalOpen = false">Cancelar</button>
          <button type="submit" class="btn primary grow" :disabled="busy">Guardar</button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
.shift-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.shift { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border-radius: 12px; padding: 4px 6px 4px 12px; }
.templates { display: flex; flex-wrap: wrap; gap: 8px; }
.template { background: var(--surface-2); color: var(--text-2); border: 1.5px solid transparent; }
.template.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.template:disabled { opacity: 0.5; pointer-events: none; }
.shift-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.shift-actions .btn { font-size: 13px; padding: 8px 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
.btn:disabled { opacity: 0.5; pointer-events: none; }
</style>
