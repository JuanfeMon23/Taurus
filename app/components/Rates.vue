<script setup lang="ts">
import { Plus, Tag } from 'lucide-vue-next'
import type { Category } from '../utils/calc'
import { categoryRate } from '../utils/calc'
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
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  categories.value = await taurus.repo.listCategories()
}
onMounted(async () => {
  taurus = await useTaurus()
  await load()
})

const val = (e: Event) => Number((e.target as HTMLInputElement).value)
const totalRate = computed(() => categories.value.filter(c => c.active).reduce((s, c) => s + categoryRate(c), 0))

async function save(c: Category) {
  await taurus.repo.saveCategory(c)
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

    <div v-for="c in categories" :key="c.id" class="card stack" :class="{ off: !c.active }" style="gap: 12px">
      <div class="row">
        <span class="icon-tile"><component :is="categoryIcon(c.name)" :size="20" /></span>
        <div class="grow">
          <b>{{ c.name }}</b>
          <p class="muted small num">{{ rate(categoryRate(c)) }}</p>
        </div>
        <button class="switch" :class="{ on: c.active }" role="switch" :aria-checked="c.active" :aria-label="`Activar ${c.name}`"
          @click="save({ ...c, active: !c.active })" />
      </div>
      <div v-if="c.rateMode === 'direct'" class="field">
        <span>Valor por km ($)</span>
        <input class="input" type="number" inputmode="decimal" :value="c.ratePerKm" @change="save({ ...c, ratePerKm: val($event) })">
      </div>
      <div v-else class="grid2">
        <label class="field">
          <span>Costo total ($)</span>
          <input class="input" type="number" inputmode="decimal" :value="c.totalCost" @change="save({ ...c, totalCost: val($event) })">
        </label>
        <label class="field">
          <span>Cada (km)</span>
          <input class="input" type="number" inputmode="decimal" :value="c.intervalKm" @change="save({ ...c, intervalKm: val($event) })">
        </label>
      </div>
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
.card { transition: opacity 0.3s; }
</style>
