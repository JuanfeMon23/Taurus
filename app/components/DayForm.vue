<script setup lang="ts">
import { ArrowLeftRight, Banknote, CalendarDays, Check, NotebookPen, Plus, Route, TrendingDown, TrendingUp, X } from 'lucide-vue-next'
import { computeDay, type Category } from '../utils/calc'
import { money, rate, todayISO } from '../utils/format'
import { categoryIcon } from '../utils/icons'
import type { PayMethod } from '../services/types'

// El id se conserva al editar para que la sincronización reconozca el mismo servicio.
type Row = { id?: string; amount: number | null; method: PayMethod }
const blank = (): Row => ({ amount: null, method: 'cash' })

const date = ref(todayISO())
const km = ref<number | null>(null)
const note = ref('')
const services = ref<Row[]>([blank()])
const categories = ref<Category[]>([])
const saving = ref(false)
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  const existing = await taurus.repo.getDay(date.value)
  km.value = existing?.km ?? null
  note.value = existing?.note ?? ''
  services.value = existing?.services.length
    ? existing.services.map(s => ({ id: s.id, amount: s.amount, method: s.method ?? 'cash' }))
    : [blank()]
}

onMounted(async () => {
  taurus = await useTaurus()
  categories.value = await taurus.repo.listCategories()
  await load()
})
// KeepAlive: refrescar tarifas si cambiaron en la pestaña Tarifas.
onActivated(async () => {
  if (taurus) categories.value = await taurus.repo.listCategories()
})
watch(date, () => taurus && load())

const result = computed(() => computeDay({
  services: services.value.map(s => s.amount ?? 0),
  km: km.value ?? 0,
  categories: categories.value,
}))
const costShare = (amount: number) => (result.value.totalCost > 0 ? Math.max((amount / result.value.totalCost) * 100, 4) : 0)
const margin = computed(() => (result.value.gross > 0 ? Math.round((result.value.net / result.value.gross) * 100) : 0))

async function save() {
  saving.value = true
  try {
    await taurus.saveDay({
      date: date.value,
      km: km.value ?? 0,
      note: note.value || undefined,
      services: services.value.filter(s => !!s.amount).map(s => ({ id: s.id, amount: s.amount as number, method: s.method })),
    })
    show('Día guardado')
    await load() // trae los ids asignados a servicios nuevos
  } catch {
    show('No se pudo guardar', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="stack rise">
    <!-- Hero: neto del día -->
    <div class="hero card">
      <div class="row between">
        <span class="hero-label"><component :is="result.net >= 0 ? TrendingUp : TrendingDown" :size="16" /> Neto del día</span>
        <span v-if="result.gross > 0" class="badge" :class="result.net >= 0 ? 'open' : 'closed'">{{ margin }}% de margen</span>
      </div>
      <p class="hero-value" :class="result.net < 0 ? 'neg' : ''"><AnimatedNumber :value="result.net" /></p>
      <div class="hero-meta">
        <div><span>Bruto</span><b><AnimatedNumber :value="result.gross" /></b></div>
        <div><span>Costos</span><b><AnimatedNumber :value="result.totalCost" /></b></div>
        <div><span>Km</span><b class="num">{{ km ?? 0 }}</b></div>
      </div>
    </div>

    <!-- Registro -->
    <div class="card stack">
      <label class="field">
        <span>Fecha</span>
        <div class="input-icon">
          <CalendarDays :size="18" />
          <input v-model="date" type="date" class="input">
        </div>
      </label>

      <div class="stack" style="gap: 10px">
        <span class="title">Servicios</span>
        <TransitionGroup name="list" tag="div" class="stack rel" style="gap: 10px">
          <div v-for="(s, i) in services" :key="i" class="row">
            <div class="input-icon grow">
              <component :is="s.method === 'cash' ? Banknote : ArrowLeftRight" :size="18" />
              <input v-model.number="s.amount" type="number" inputmode="decimal" placeholder="Monto" class="input">
            </div>
            <button class="chip" :class="s.method" @click="s.method = s.method === 'cash' ? 'transfer' : 'cash'">
              {{ s.method === 'cash' ? 'Efectivo' : 'Transf.' }}
            </button>
            <button v-if="services.length > 1" class="btn icon ghost" aria-label="Quitar servicio" @click="services.splice(i, 1)">
              <X :size="18" />
            </button>
          </div>
        </TransitionGroup>
        <button class="btn dashed block" @click="services.push(blank())"><Plus :size="18" /> Agregar servicio</button>
      </div>

      <label class="field">
        <span>Kilómetros del día</span>
        <div class="input-icon">
          <Route :size="18" />
          <input v-model.number="km" type="number" inputmode="decimal" placeholder="0" class="input">
        </div>
      </label>

      <label class="field">
        <span>Nota</span>
        <div class="input-icon">
          <NotebookPen :size="18" />
          <input v-model="note" type="text" placeholder="Opcional" class="input">
        </div>
      </label>
    </div>

    <!-- Costos -->
    <div class="card stack" style="gap: 12px">
      <span class="title">Costos del día</span>
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

    <button class="btn primary block big" :disabled="saving" @click="save">
      <Check :size="20" /> Guardar día
    </button>
  </section>
</template>

<style scoped>
.rel { position: relative; }
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
.hero-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; position: relative; }
.hero-meta > div { background: var(--surface-2); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; }
.hero-meta span { font-size: 12px; color: var(--muted); font-weight: 500; }
.hero-meta b { font-size: 15px; }
.cost .bar { height: 6px; border-radius: 99px; background: var(--surface-2); margin-top: 10px; overflow: hidden; }
.cost .bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 0.6s var(--ease); }
.big { padding: 16px; font-size: 17px; border-radius: 16px; }
.btn:disabled { opacity: 0.6; pointer-events: none; }
</style>
