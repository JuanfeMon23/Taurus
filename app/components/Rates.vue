<script setup lang="ts">
import { Plus, Tag } from 'lucide-vue-next'
import type { Category } from '../utils/calc'
import { categoryRate } from '../utils/calc'
import { percentToRate, ratesToPercent, validateRates, type RatesFormErrors } from '../utils/commission'
import { rate } from '../utils/format'
import { categoryIcon } from '../utils/icons'

const categories = ref<Category[]>([])
const draft = reactive({
  name: '',
  rateMode: 'direct' as 'direct' | 'derived',
  ratePerKm: null as number | null,
  totalCost: null as number | null,
  intervalKm: null as number | null,
})
const commissionForm = reactive({ commissionPercent: null as number | null, vatPercent: null as number | null })
const commissionErrors = ref<RatesFormErrors>({})
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  categories.value = await taurus.repo.listCategories()
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
    show(error instanceof Error && error.message ? error.message : 'No se pudo guardar', 'error')
  }
}
onMounted(async () => {
  taurus = await useTaurus()
  await load()
})

const readInputNumber = (event: Event) => Number((event.target as HTMLInputElement).value)
const totalRate = computed(() => categories.value.filter(category => category.active).reduce((total, category) => total + categoryRate(category), 0))

async function save(category: Category) {
  await taurus.repo.saveCategory(category)
  await load()
}

async function add() {
  if (!draft.name.trim()) return
  await taurus.repo.saveCategory({
    name: draft.name.trim(),
    rateMode: draft.rateMode,
    ratePerKm: draft.rateMode === 'direct' ? draft.ratePerKm ?? 0 : undefined,
    totalCost: draft.rateMode === 'derived' ? draft.totalCost ?? 0 : undefined,
    intervalKm: draft.rateMode === 'derived' ? draft.intervalKm ?? 0 : undefined,
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
          <p class="muted small num">{{ rate(categoryRate(category)) }}</p>
        </div>
        <button class="switch" :class="{ on: category.active }" role="switch" :aria-checked="category.active" :aria-label="`Activar ${category.name}`"
          @click="save({ ...category, active: !category.active })" />
      </div>
      <div v-if="category.rateMode === 'direct'" class="field">
        <span>Valor por km ($)</span>
        <input class="input" type="number" inputmode="decimal" :value="category.ratePerKm" @change="save({ ...category, ratePerKm: readInputNumber($event) })">
      </div>
      <div v-else class="grid2">
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

    <div class="card stack">
      <span class="title">Nueva categoría</span>
      <div class="input-icon">
        <Tag :size="18" />
        <input v-model="draft.name" type="text" placeholder="Ej. Seguro" class="input">
      </div>
      <div class="seg" :style="{ '--n': 2, '--i': draft.rateMode === 'direct' ? 0 : 1 }">
        <span class="thumb" />
        <button :class="{ active: draft.rateMode === 'direct' }" @click="draft.rateMode = 'direct'">Valor por km</button>
        <button :class="{ active: draft.rateMode === 'derived' }" @click="draft.rateMode = 'derived'">Costo / cada X km</button>
      </div>
      <input v-if="draft.rateMode === 'direct'" v-model.number="draft.ratePerKm" type="number" inputmode="decimal" placeholder="$ por km" class="input">
      <div v-else class="grid2">
        <input v-model.number="draft.totalCost" type="number" inputmode="decimal" placeholder="Costo total" class="input">
        <input v-model.number="draft.intervalKm" type="number" inputmode="decimal" placeholder="Cada cuántos km" class="input">
      </div>
      <button class="btn primary block" @click="add"><Plus :size="18" /> Agregar</button>
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
