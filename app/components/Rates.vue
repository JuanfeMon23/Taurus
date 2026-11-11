<script setup lang="ts">
import { Plus, Tag } from 'lucide-vue-next'
import type { Category } from '../utils/calc'
import { categoryRate } from '../utils/calc'
import { percentToRate, ratesToPercent, validateRates, type RatesFormErrors } from '../utils/commission'
import { rate } from '../utils/format'
import { toUserMessage } from '../utils/errors'
import { categoryIcon } from '../utils/icons'

const categories = ref<Category[]>([])
const draft = reactive({
  name: '',
  rateMode: '',
  ratePerKm: null as number | null,
  totalCost: null as number | null,
  intervalKm: null as number | null,
})
const commissionForm = reactive({ commissionPercent: null as number | null, vatPercent: null as number | null })
const commissionErrors = ref<RatesFormErrors>({})
const { show } = useNotify()
const { catalogs, activeRateModes, refreshCatalogs } = useCatalogs()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  categories.value = await taurus.repo.listCategories()
  await refreshCatalogs()
  if (!activeRateModes.value.some(mode => mode.id === draft.rateMode)) draft.rateMode = activeRateModes.value[0]?.id ?? ''
  const rates = await taurus.repo.getRates()
  commissionForm.commissionPercent = ratesToPercent(rates.commissionRate)
  commissionForm.vatPercent = ratesToPercent(rates.vatRate)
}

async function saveCommission() {
  commissionErrors.value = validateRates(commissionForm)
  if (Object.keys(commissionErrors.value).length) {
    show('Revisa los porcentajes', 'error')
    return
  }
  try {
    await taurus.repo.saveRates({ commissionRate: percentToRate(commissionForm.commissionPercent!), vatRate: percentToRate(commissionForm.vatPercent!) })
    show('Comisión inDrive guardada')
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}
onMounted(async () => {
  taurus = await useTaurus()
  await load()
})

const readInputNumber = (event: Event) => Number((event.target as HTMLInputElement).value)
const rateModeOf = (code: string) => catalogs.value.rateModes.find(mode => mode.id === code)
const rateOf = (category: Category) => categoryRate(category, catalogs.value.rateModes)
const draftMode = computed(() => rateModeOf(draft.rateMode))
const totalRate = computed(() => categories.value.filter(category => category.active).reduce((total, category) => total + rateOf(category), 0))

async function save(category: Category) {
  await taurus.repo.saveCategory(category)
  await load()
}

async function add() {
  const mode = draftMode.value
  if (!draft.name.trim() || !mode) return
  await taurus.repo.saveCategory({
    name: draft.name.trim(),
    rateMode: draft.rateMode,
    ratePerKm: mode.usesRatePerKm ? draft.ratePerKm ?? 0 : undefined,
    totalCost: mode.usesCostInterval ? draft.totalCost ?? 0 : undefined,
    intervalKm: mode.usesCostInterval ? draft.intervalKm ?? 0 : undefined,
    active: true,
  })
  Object.assign(draft, { name: '', ratePerKm: null, totalCost: null, intervalKm: null })
  show('Categoría agregada')
  await load()
}
</script>

<template>
  <section class="stack rise">
    <div class="card total">
      <span class="title">Costo total por km</span>
      <p class="value num">{{ rate(totalRate) }}</p>
      <p class="muted small">Los cambios aplican a días nuevos; los ya guardados conservan su tarifa.</p>
    </div>

    <div v-for="category in categories" :key="category.id" class="card stack" :class="{ off: !category.active }" style="gap: 12px">
      <div class="row">
        <span class="icon-tile"><component :is="categoryIcon(category.name)" :size="20" /></span>
        <div class="grow">
          <b>{{ category.name }}</b>
          <p class="muted small num">{{ rate(rateOf(category)) }}</p>
        </div>
        <button class="switch" :class="{ on: category.active }" role="switch" :aria-checked="category.active" :aria-label="`Activar ${category.name}`"
          @click="save({ ...category, active: !category.active })" />
      </div>
      <p v-if="!rateModeOf(category.rateMode)" class="muted small">Modo de tarifa «{{ category.rateMode }}» no disponible; revísalo en Catálogos.</p>
      <div v-if="rateModeOf(category.rateMode)?.usesRatePerKm" class="field">
        <span>Valor por km ($)</span>
        <input class="input" type="number" inputmode="decimal" :value="category.ratePerKm" @change="save({ ...category, ratePerKm: readInputNumber($event) })">
      </div>
      <div v-if="rateModeOf(category.rateMode)?.usesCostInterval" class="grid2">
        <label class="field">
          <span>Costo total ($)</span>
          <input class="input" type="number" inputmode="decimal" :value="category.totalCost" @change="save({ ...category, totalCost: readInputNumber($event) })">
        </label>
        <label class="field">
          <span>Cada (km)</span>
          <input class="input" type="number" inputmode="decimal" :value="category.intervalKm" @change="save({ ...category, intervalKm: readInputNumber($event) })">
        </label>
      </div>
    </div>

    <div class="card stack" style="gap: 12px">
      <span class="title">Comisión inDrive</span>
      <div class="grid2">
        <label class="field">
          <span>Comisión (%)</span>
          <input v-model.number="commissionForm.commissionPercent" class="input" type="number" inputmode="decimal" min="0" max="100" step="any"
            :aria-invalid="!!commissionErrors.commissionPercent" @change="saveCommission">
          <small v-if="commissionErrors.commissionPercent" class="err" role="alert">{{ commissionErrors.commissionPercent }}</small>
        </label>
        <label class="field">
          <span>IVA sobre la comisión (%)</span>
          <input v-model.number="commissionForm.vatPercent" class="input" type="number" inputmode="decimal" min="0" max="100" step="any"
            :aria-invalid="!!commissionErrors.vatPercent" @change="saveCommission">
          <small v-if="commissionErrors.vatPercent" class="err" role="alert">{{ commissionErrors.vatPercent }}</small>
        </label>
      </div>
      <p class="muted small">Se calcula sobre el dinero del viaje sin bonus. Los cambios aplican a viajes nuevos o editados; los guardados conservan su comisión.</p>
    </div>

    <ShiftTemplatesEditor />

    <div class="card stack">
      <span class="title">Catálogos</span>
      <p class="muted small">Opciones de medios de pago, movimientos, categorías de gasto y modos de tarifa. Una opción en uso solo se desactiva.</p>
    </div>
    <CatalogEditor kind="accounts" title="Cuentas" hint="Dónde está el dinero: cada cuenta tiene su saldo inicial. La caja sigue el ciclo diario (apertura y cierre); su saldo inicial solo cuenta antes de abrir la primera caja." />
    <CatalogEditor kind="paymentMethods" title="Medios de pago" hint="Cada medio lleva su dinero a una cuenta; «Afecta caja» se deriva de ella (solo si es la caja)." />
    <CatalogEditor kind="movementTypes" title="Tipos de movimiento de caja" hint="«Suma» o «Resta» define cómo mueve la cuenta; «Lleva destino» = traslado: resta al origen y suma a la cuenta de destino." />
    <CatalogEditor kind="fundMovementTypes" title="Tipos de movimiento de fondo" hint="«Suma» o «Resta» define cómo mueve el saldo del fondo." />
    <CatalogEditor kind="expenseCategories" title="Categorías de gasto" />
    <CatalogEditor kind="rateModes" title="Modos de tarifa" hint="Qué campos pide una categoría: «Valor por km» = $ por km; «Costo cada X km» = costo total entre los km de cada intervalo." />

    <div class="card stack">
      <span class="title">Nueva categoría</span>
      <div class="input-icon">
        <Tag :size="18" />
        <input v-model="draft.name" type="text" placeholder="Ej. Seguro" class="input">
      </div>
      <div class="seg" :style="{ '--n': Math.max(activeRateModes.length, 1), '--i': Math.max(activeRateModes.findIndex(mode => mode.id === draft.rateMode), 0) }">
        <span class="thumb" />
        <button v-for="mode in activeRateModes" :key="mode.id" :class="{ active: draft.rateMode === mode.id }" @click="draft.rateMode = mode.id">{{ mode.name }}</button>
      </div>
      <input v-if="draftMode?.usesRatePerKm" v-model.number="draft.ratePerKm" type="number" inputmode="decimal" placeholder="$ por km" class="input">
      <div v-if="draftMode?.usesCostInterval" class="grid2">
        <input v-model.number="draft.totalCost" type="number" inputmode="decimal" placeholder="Costo total" class="input">
        <input v-model.number="draft.intervalKm" type="number" inputmode="decimal" placeholder="Cada cuántos km" class="input">
      </div>
      <button class="btn primary full" @click="add"><Plus :size="18" /> Agregar</button>
    </div>
  </section>
</template>

<style scoped>
.total .value { font-size: 36px; font-weight: 800; letter-spacing: -0.02em; color: var(--accent); margin: 4px 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.off { opacity: 0.6; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
.input[aria-invalid='true'] { border-color: var(--neg); }
.card { transition: opacity 0.3s; }
</style>
