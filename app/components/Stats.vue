<script setup lang="ts">
import { ChartColumn, CircleDollarSign, Gauge, Route, Table2, TrendingUp, Trophy, Wallet } from 'lucide-vue-next'
import type { DayRecord } from '../services/types'
import { aggregate, summarize, type Granularity } from '../utils/stats'
import { money } from '../utils/format'

const days = ref<DayRecord[]>([])
const catOrder = ref<string[]>([])
const g = ref<Granularity>('day')
const table = ref(false)
const selected = ref<string | null>(null)

async function load() {
  const t = await useTaurus()
  days.value = await t.repo.listDays()
  catOrder.value = (await t.repo.listCategories()).map(c => c.id)
}
onMounted(load)
onActivated(load)

const MODES = [['day', 'Día'], ['month', 'Mes'], ['year', 'Año']] as const
const LIMIT: Record<Granularity, number> = { day: 14, month: 12, year: 10 }
const KEYLEN: Record<Granularity, number> = { day: 10, month: 7, year: 4 }
const buckets = computed(() => aggregate(days.value, g.value).slice(-LIMIT[g.value]))
const sum = computed(() => {
  const keys = new Set(buckets.value.map(b => b.key))
  return summarize(days.value.filter(d => keys.has(d.date.slice(0, KEYLEN[g.value]))))
})

// Color por entidad: Neto = serie 1; cada categoría conserva su serie según su id.
const slot = (id: string) => Math.min(2 + Math.max(catOrder.value.indexOf(id), 0), 8)
interface Seg { label: string; value: number; color: string }
const segs = (b: (typeof buckets.value)[number]): Seg[] => [
  { label: 'Neto', value: Math.max(b.net, 0), color: 'var(--s1)' },
  ...[...b.costs.entries()]
    .sort((a, c) => slot(a[0]) - slot(c[0]))
    .map(([id, c]) => ({ label: c.name, value: c.amount, color: `var(--s${slot(id)})` })),
]

const legend = computed(() => {
  const seen = new Map<string, string>([['Neto', 'var(--s1)']])
  for (const b of buckets.value) for (const [id, c] of b.costs) seen.set(c.name, `var(--s${slot(id)})`)
  return [...seen.entries()]
})

// Geometría
const W = 340, H = 210, L = 40, T = 14, B = 28
const plotW = W - L - 8, plotH = H - T - B
const maxVal = computed(() => {
  const m = Math.max(0, ...buckets.value.map(b => segs(b).reduce((s, x) => s + x.value, 0)))
  if (m === 0) return 1
  const p = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / p / 2) * p * 2
})
const ticks = computed(() => [0, 0.5, 1].map(f => f * maxVal.value))
const y = (v: number) => T + plotH - (v / maxVal.value) * plotH
const slotW = computed(() => plotW / Math.max(buckets.value.length, 1))
const barW = computed(() => Math.min(24, slotW.value * 0.7))

function compact(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
const label = (key: string) => (g.value === 'day' ? key.slice(8) : g.value === 'month' ? key.slice(5) : key)

/** Rect con esquinas superiores redondeadas (4px) y base recta. */
function seg(x: number, top: number, h: number, w: number, round: boolean) {
  const r = round ? Math.min(4, h, w / 2) : 0
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`
}

function rects(b: (typeof buckets.value)[number], i: number) {
  const x = L + i * slotW.value + (slotW.value - barW.value) / 2
  let acc = 0
  const items = segs(b).filter(s => s.value > 0)
  return items.map((s, k) => {
    const top = y(acc + s.value)
    const h = y(acc) - top
    acc += s.value
    return { d: seg(x, top, Math.max(h - 2, 1), barW.value, k === items.length - 1), color: s.color }
  })
}

const sel = computed(() => buckets.value.find(b => b.key === selected.value) ?? null)
// Cambiar de rango reinicia la animación de crecimiento de las barras.
const chartKey = computed(() => `${g.value}-${buckets.value.length}`)
</script>

<template>
  <section class="stack">
    <div class="seg" :style="{ '--n': 3, '--i': MODES.findIndex(m => m[0] === g) }">
      <span class="thumb" />
      <button v-for="[k, l] in MODES" :key="k" :class="{ active: g === k }" @click="g = k; selected = null">{{ l }}</button>
    </div>

    <div v-if="!days.length" class="card empty">
      <ChartColumn :size="40" />
      <b>Sin datos todavía</b>
      <p class="small">Registra días para ver tus estadísticas.</p>
    </div>

    <template v-else>
      <!-- Bento -->
      <div class="bento rise">
        <div class="card hero">
          <span class="title"><TrendingUp :size="14" /> Neto</span>
          <p class="hero-value" :class="sum.net >= 0 ? 'pos' : 'neg'"><AnimatedNumber :value="sum.net" /></p>
          <p class="muted small">{{ sum.days }} {{ sum.days === 1 ? 'día' : 'días' }} en el período</p>
        </div>
        <div class="card tile">
          <span class="icon-tile info"><Wallet :size="18" /></span>
          <span class="muted small">Bruto</span><b class="num">{{ money(sum.gross) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile neg"><CircleDollarSign :size="18" /></span>
          <span class="muted small">Costos</span><b class="num">{{ money(sum.totalCost) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile pos"><Gauge :size="18" /></span>
          <span class="muted small">Neto por día</span><b class="num">{{ money(sum.avgNet) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile"><Route :size="18" /></span>
          <span class="muted small">{{ Math.round(sum.km) }} km · neto/km</span><b class="num">{{ money(sum.netPerKm) }}</b>
        </div>
        <div class="card tile wide">
          <span class="icon-tile"><Trophy :size="18" /></span>
          <div>
            <span class="muted small">Mejor día</span>
            <b class="num block">{{ sum.best ? money(sum.best.net) : '—' }}</b>
          </div>
          <span v-if="sum.best" class="muted small best-date">{{ sum.best.date }}</span>
        </div>
      </div>

      <!-- Gráfica -->
      <div class="card stack" style="gap: 12px">
        <div class="row between">
          <span class="title">Composición del bruto</span>
          <button class="btn icon ghost" :aria-label="table ? 'Ver gráfica' : 'Ver tabla'" @click="table = !table">
            <component :is="table ? ChartColumn : Table2" :size="18" />
          </button>
        </div>
        <div class="legend">
          <span v-for="[name, color] in legend" :key="name"><i :style="{ background: color }" />{{ name }}</span>
        </div>

        <svg v-if="!table" :key="chartKey" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Ingreso bruto por período, dividido en neto y costos">
          <g v-for="t in ticks" :key="t">
            <line :x1="L" :x2="W - 8" :y1="y(t)" :y2="y(t)" class="grid" />
            <text :x="L - 6" :y="y(t) + 4" class="tick" text-anchor="end">{{ compact(t) }}</text>
          </g>
          <g v-for="(b, i) in buckets" :key="b.key" class="col" @click="selected = selected === b.key ? null : b.key">
            <rect :x="L + i * slotW" :y="T" :width="slotW" :height="plotH" fill="transparent" />
            <g class="bar" :style="{ animationDelay: i * 35 + 'ms', opacity: selected && selected !== b.key ? 0.35 : 1 }">
              <path v-for="(r, k) in rects(b, i)" :key="k" :d="r.d" :fill="r.color" />
            </g>
            <text :x="L + i * slotW + slotW / 2" :y="H - 10" class="tick" :class="{ sel: selected === b.key }" text-anchor="middle">{{ label(b.key) }}</text>
          </g>
        </svg>

        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Período</th><th>Bruto</th><th>Costos</th><th>Neto</th><th>Km</th></tr></thead>
            <tbody>
              <tr v-for="b in buckets" :key="b.key">
                <td>{{ b.key }}</td><td>{{ money(b.gross) }}</td><td>{{ money(b.totalCost) }}</td><td>{{ money(b.net) }}</td><td>{{ Math.round(b.km) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Transition name="page">
          <div v-if="sel && !table" class="tip">
            <b>{{ sel.key }}</b>
            <div v-for="s in segs(sel)" :key="s.label"><span><i :style="{ background: s.color }" />{{ s.label }}</span><b class="num">{{ money(s.value) }}</b></div>
            <div class="total"><span>Bruto</span><b class="num">{{ money(sel.gross) }}</b></div>
          </div>
          <p v-else-if="!table" class="muted small">Toca una barra para ver el detalle.</p>
        </Transition>
      </div>
    </template>
  </section>
</template>

<style scoped>
.bento { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bento .hero { grid-column: span 2; background: linear-gradient(145deg, var(--surface) 0%, var(--surface-2) 100%); }
.hero .title { display: inline-flex; align-items: center; gap: 6px; }
.hero-value { font-size: 40px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin: 4px 0; }
.tile { display: flex; flex-direction: column; gap: 4px; padding: 14px; }
.tile .icon-tile { width: 34px; height: 34px; border-radius: 10px; margin-bottom: 4px; }
.tile b { font-size: 18px; }
.tile.wide { grid-column: span 2; flex-direction: row; align-items: center; gap: 12px; }
.tile.wide .icon-tile { margin: 0; }
.block { display: block; }
.best-date { margin-left: auto; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--muted); }
.legend i, .tip i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
svg { width: 100%; height: auto; overflow: visible; }
.grid { stroke: var(--border); stroke-width: 1; }
.tick { fill: var(--muted); font-size: 11px; transition: fill 0.2s; }
.tick.sel { fill: var(--accent); font-weight: 700; }
.col { cursor: pointer; }
.bar { transform-box: fill-box; transform-origin: 50% 100%; animation: grow 0.7s cubic-bezier(0.34, 1.4, 0.64, 1) both; transition: opacity 0.25s; }
.tip { background: var(--surface-2); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.tip div { display: flex; justify-content: space-between; }
.tip .total { border-top: 1px solid var(--border); padding-top: 6px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: right; padding: 8px 4px; border-bottom: 1px solid var(--border); }
th:first-child, td:first-child { text-align: left; }
th { color: var(--muted); font-weight: 600; }
td { font-variant-numeric: tabular-nums; }
</style>
