<script setup lang="ts">
import { Plus, Trash2 } from 'lucide-vue-next'
import type { CatalogEntry, CatalogKind, Snapshot } from '../services/types'
import { catalogEntryInUse } from '../utils/catalogs'
import { toUserMessage } from '../utils/errors'
import { validateCatalogEntryInput } from '../utils/validation'

/**
 * Edita un catálogo (nombre, orden, activo; signo en los tipos; «afecta caja» en los medios de pago; qué campos pide la tarifa en los modos de tarifa). El código de una
 * entrada nunca cambia; una entrada en uso solo se desactiva y no se le cambia el efecto sobre los saldos.
 */
const props = defineProps<{ kind: CatalogKind; title: string; hint?: string }>()

const { catalogs, refreshCatalogs } = useCatalogs()
const { show } = useNotify()
const snapshot = ref<Pick<Snapshot, 'services' | 'movements' | 'fundMovements' | 'categories'> | null>(null)
const draft = reactive({ name: '', affectsCash: true, sign: 1 as 1 | -1, hasCategory: false, usesRatePerKm: true, usesCostInterval: false })
const draftError = ref<string | null>(null)
const rowError = ref<{ id: string; message: string } | null>(null)
let taurus: Awaited<ReturnType<typeof useTaurus>>

const entries = computed(() => catalogs.value[props.kind] as (CatalogEntry & { affectsCash?: boolean; sign?: 1 | -1; hasCategory?: boolean; usesRatePerKm?: boolean; usesCostInterval?: boolean })[])
const hasSign = computed(() => props.kind === 'movementTypes' || props.kind === 'fundMovementTypes')
const hasCategoryFlag = computed(() => props.kind === 'movementTypes')
const hasAffectsCash = computed(() => props.kind === 'paymentMethods')
const hasRateFlags = computed(() => props.kind === 'rateModes')
const inUse = (id: string) => !!snapshot.value && catalogEntryInUse(snapshot.value, props.kind, id)

async function load() {
  taurus = await useTaurus()
  await refreshCatalogs()
  snapshot.value = await taurus.snapshot()
}
onMounted(load)
onActivated(load)

async function persist(entry: Record<string, unknown>, message?: string) {
  try {
    await taurus.repo.saveCatalogEntry(props.kind, entry as never)
    await load()
    if (message) show(message)
    return true
  } catch (error) {
    show(toUserMessage(error), 'error')
    return false
  }
}

async function rename(entry: CatalogEntry, event: Event) {
  const input = event.target as HTMLInputElement
  const message = validateCatalogEntryInput(input.value, entries.value.filter(other => other.id !== entry.id).map(other => other.name))
  rowError.value = message ? { id: entry.id, message } : null
  if (message) {
    input.value = entry.name
    return
  }
  await persist({ ...entry, name: input.value })
}

const reorder = (entry: CatalogEntry, event: Event) => persist({ ...entry, sortOrder: Math.trunc(Number((event.target as HTMLInputElement).value)) || 0 })

async function remove(entry: CatalogEntry) {
  try {
    await taurus.repo.deleteCatalogEntry(props.kind, entry.id)
    await load()
    show('Eliminado')
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}

async function add() {
  draftError.value = validateCatalogEntryInput(draft.name, entries.value.map(entry => entry.name))
  if (draftError.value) return
  const extra = hasAffectsCash.value ? { affectsCash: draft.affectsCash }
    : hasRateFlags.value ? { usesRatePerKm: draft.usesRatePerKm, usesCostInterval: draft.usesCostInterval }
    : hasSign.value ? { sign: draft.sign, ...(hasCategoryFlag.value ? { hasCategory: draft.hasCategory } : {}) } : {}
  if (await persist({ name: draft.name, ...extra }, 'Agregado')) Object.assign(draft, { name: '', affectsCash: true, sign: 1, hasCategory: false, usesRatePerKm: true, usesCostInterval: false })
}
</script>

<template>
  <div class="card stack" style="gap: 12px" :data-catalog="kind">
    <div>
      <span class="title">{{ title }}</span>
      <p v-if="hint" class="muted small">{{ hint }}</p>
    </div>

    <p v-if="!entries.length" class="muted small">Sin opciones todavía.</p>
    <div v-for="entry in entries" :key="entry.id" class="entry" :class="{ off: !entry.active }">
      <input class="input name" type="text" maxlength="60" :value="entry.name" :aria-label="`Nombre de ${entry.name}`" @change="rename(entry, $event)">
      <input class="input order" type="number" inputmode="numeric" step="1" :value="entry.sortOrder" :aria-label="`Orden de ${entry.name}`" @change="reorder(entry, $event)">
      <button v-if="hasAffectsCash" type="button" class="chip" :class="entry.affectsCash ? 'pos' : 'info'" :disabled="inUse(entry.id)" :aria-pressed="!!entry.affectsCash"
        :title="inUse(entry.id) ? 'En uso: no se puede cambiar' : 'Si el dinero entra o sale de la caja'" @click="persist({ ...entry, affectsCash: !entry.affectsCash })">
        {{ entry.affectsCash ? 'Afecta caja' : 'No afecta caja' }}
      </button>
      <button v-if="hasSign" type="button" class="chip" :class="entry.sign === 1 ? 'pos' : 'info'" :disabled="inUse(entry.id)"
        :title="inUse(entry.id) ? 'En uso: no se puede cambiar' : 'Si suma o resta al saldo'" @click="persist({ ...entry, sign: entry.sign === 1 ? -1 : 1 })">
        {{ entry.sign === 1 ? 'Suma' : 'Resta' }}
      </button>
      <button v-if="hasCategoryFlag" type="button" class="chip" :class="entry.hasCategory ? 'pos' : 'info'" :aria-pressed="!!entry.hasCategory"
        title="Si el movimiento pide categoría de gasto" @click="persist({ ...entry, hasCategory: !entry.hasCategory })">
        {{ entry.hasCategory ? 'Lleva categoría' : 'Sin categoría' }}
      </button>
      <template v-if="hasRateFlags">
        <button type="button" class="chip" :class="entry.usesRatePerKm ? 'pos' : 'info'" :disabled="inUse(entry.id)" :aria-pressed="!!entry.usesRatePerKm"
          :title="inUse(entry.id) ? 'En uso: no se puede cambiar' : 'Si la tarifa pide un valor por km'" @click="persist({ ...entry, usesRatePerKm: !entry.usesRatePerKm })">
          {{ entry.usesRatePerKm ? 'Valor por km' : 'Sin valor por km' }}
        </button>
        <button type="button" class="chip" :class="entry.usesCostInterval ? 'pos' : 'info'" :disabled="inUse(entry.id)" :aria-pressed="!!entry.usesCostInterval"
          :title="inUse(entry.id) ? 'En uso: no se puede cambiar' : 'Si la tarifa pide costo total y cada cuántos km'" @click="persist({ ...entry, usesCostInterval: !entry.usesCostInterval })">
          {{ entry.usesCostInterval ? 'Costo cada X km' : 'Sin costo cada X km' }}
        </button>
      </template>
      <button class="switch" :class="{ on: entry.active }" role="switch" :aria-checked="entry.active" :aria-label="`Activar ${entry.name}`" @click="persist({ ...entry, active: !entry.active })" />
      <button type="button" class="btn icon ghost" :disabled="inUse(entry.id)" :aria-label="`Eliminar ${entry.name}`" :title="inUse(entry.id) ? 'En uso: solo se puede desactivar' : 'Eliminar'" @click="remove(entry)">
        <Trash2 :size="16" />
      </button>
      <small v-if="rowError?.id === entry.id" class="err" role="alert">{{ rowError.message }}</small>
    </div>

    <form class="entry add" novalidate @submit.prevent="add">
      <input v-model="draft.name" class="input name" type="text" maxlength="60" placeholder="Nueva opción" :aria-label="`Nueva opción en ${title}`" :aria-invalid="!!draftError">
      <button v-if="hasAffectsCash" type="button" class="chip" :class="draft.affectsCash ? 'pos' : 'info'" :aria-pressed="draft.affectsCash" @click="draft.affectsCash = !draft.affectsCash">
        {{ draft.affectsCash ? 'Afecta caja' : 'No afecta caja' }}
      </button>
      <button v-if="hasSign" type="button" class="chip" :class="draft.sign === 1 ? 'pos' : 'info'" @click="draft.sign = draft.sign === 1 ? -1 : 1">
        {{ draft.sign === 1 ? 'Suma' : 'Resta' }}
      </button>
      <button v-if="hasCategoryFlag" type="button" class="chip" :class="draft.hasCategory ? 'pos' : 'info'" :aria-pressed="draft.hasCategory" @click="draft.hasCategory = !draft.hasCategory">
        {{ draft.hasCategory ? 'Lleva categoría' : 'Sin categoría' }}
      </button>
      <template v-if="hasRateFlags">
        <button type="button" class="chip" :class="draft.usesRatePerKm ? 'pos' : 'info'" :aria-pressed="draft.usesRatePerKm" @click="draft.usesRatePerKm = !draft.usesRatePerKm">
          {{ draft.usesRatePerKm ? 'Valor por km' : 'Sin valor por km' }}
        </button>
        <button type="button" class="chip" :class="draft.usesCostInterval ? 'pos' : 'info'" :aria-pressed="draft.usesCostInterval" @click="draft.usesCostInterval = !draft.usesCostInterval">
          {{ draft.usesCostInterval ? 'Costo cada X km' : 'Sin costo cada X km' }}
        </button>
      </template>
      <button type="submit" class="btn primary"><Plus :size="16" /> Agregar</button>
      <small v-if="draftError" class="err" role="alert">{{ draftError }}</small>
    </form>
  </div>
</template>

<style scoped>
.entry { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.entry .name { flex: 1 1 140px; min-width: 0; }
.entry .order { width: 64px; text-align: center; }
.entry.off .name { opacity: 0.6; }
.entry :disabled { opacity: 0.5; pointer-events: none; }
.err { flex-basis: 100%; color: var(--neg); font-size: 12px; font-weight: 600; }
.input[aria-invalid='true'] { border-color: var(--neg); }
</style>
