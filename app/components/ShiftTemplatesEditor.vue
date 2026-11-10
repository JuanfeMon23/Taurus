<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'
import type { ShiftTemplate } from '../services/types'
import { toUserMessage } from '../utils/errors'
import { validateShiftTemplateInput } from '../utils/validation'

/** Gestión de las plantillas de turno (turnos habituales): nombre, inicio, fin, orden y activa. Los turnos ya creados no cambian. */
const templates = ref<ShiftTemplate[]>([])
const draft = reactive({ name: '', startTime: '', endTime: '' })
const draftError = ref<string | null>(null)
const rowError = ref<{ id: string; message: string } | null>(null)
const confirming = ref<string | null>(null)
const { show } = useNotify()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  taurus = await useTaurus()
  templates.value = await taurus.repo.listShiftTemplates({ includeInactive: true })
  confirming.value = null
}
onMounted(load)
onActivated(load)

async function update(template: ShiftTemplate, changes: Partial<ShiftTemplate>) {
  const next = { ...template, ...changes }
  const message = validateShiftTemplateInput(next)
  rowError.value = message ? { id: template.id, message } : null
  if (message) {
    await load() // vuelve a mostrar el valor guardado
    return
  }
  try {
    await taurus.repo.saveShiftTemplate(next)
    await load()
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}

const readText = (event: Event) => (event.target as HTMLInputElement).value
const readOrder = (event: Event) => Math.trunc(Number(readText(event))) || 0

async function add() {
  draftError.value = validateShiftTemplateInput(draft)
  if (draftError.value) return
  try {
    await taurus.repo.saveShiftTemplate({ name: draft.name, startTime: draft.startTime, endTime: draft.endTime })
    Object.assign(draft, { name: '', startTime: '', endTime: '' })
    await load()
    show('Plantilla agregada')
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}

async function remove(template: ShiftTemplate) {
  if (confirming.value !== template.id) {
    confirming.value = template.id
    setTimeout(() => confirming.value === template.id && (confirming.value = null), 2500)
    return
  }
  try {
    await taurus.repo.deleteShiftTemplate(template.id)
    await load()
    show('Plantilla eliminada')
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}
</script>

<template>
  <div class="card stack" style="gap: 12px" data-section="shift-templates">
    <div>
      <span class="title">Turnos habituales</span>
      <p class="muted small">En Hoy se marcan como chips para crear el turno del día. Cambiar una plantilla no modifica los turnos ya creados.</p>
    </div>

    <p v-if="!templates.length" class="muted small">Sin plantillas todavía.</p>
    <div v-for="template in templates" :key="template.id" class="entry" :class="{ off: !template.active }">
      <input class="input name" type="text" maxlength="40" :value="template.name" :aria-label="`Nombre de ${template.name}`" @change="update(template, { name: readText($event) })">
      <input class="input time" type="time" :value="template.startTime" :aria-label="`Inicio de ${template.name}`" @change="update(template, { startTime: readText($event) })">
      <input class="input time" type="time" :value="template.endTime" :aria-label="`Fin de ${template.name}`" @change="update(template, { endTime: readText($event) })">
      <input class="input order" type="number" inputmode="numeric" step="1" :value="template.sortOrder" :aria-label="`Orden de ${template.name}`" @change="update(template, { sortOrder: readOrder($event) })">
      <button class="switch" :class="{ on: template.active }" role="switch" :aria-checked="template.active" :aria-label="`Activar ${template.name}`" @click="update(template, { active: !template.active })" />
      <button type="button" class="btn icon ghost" :class="{ danger: confirming === template.id }" :aria-label="confirming === template.id ? `Confirmar eliminación de ${template.name}` : `Eliminar ${template.name}`" @click="remove(template)">
        <Trash2 :size="16" />
      </button>
      <small v-if="rowError?.id === template.id" class="err" role="alert">{{ rowError.message }}</small>
    </div>

    <form class="entry add" novalidate @submit.prevent="add">
      <input v-model="draft.name" class="input name" type="text" maxlength="40" placeholder="Ej. Mediodía" aria-label="Nombre de la plantilla nueva" :aria-invalid="!!draftError">
      <input v-model="draft.startTime" class="input time" type="time" aria-label="Inicio de la plantilla nueva">
      <input v-model="draft.endTime" class="input time" type="time" aria-label="Fin de la plantilla nueva">
      <button type="submit" class="btn primary"><Plus :size="16" /> Agregar</button>
      <small v-if="draftError" class="err" role="alert">{{ draftError }}</small>
    </form>
  </div>
</template>

<style scoped>
.entry { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.entry .name { flex: 1 1 140px; min-width: 0; }
.entry .time { width: 110px; }
.entry .order { width: 64px; text-align: center; }
.entry.off .name { opacity: 0.6; }
.err { flex-basis: 100%; color: var(--neg); font-size: 12px; font-weight: 600; }
.input[aria-invalid='true'] { border-color: var(--neg); }
</style>
