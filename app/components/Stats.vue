<script setup lang="ts">
import { ChartColumn, CircleDollarSign, Gauge, Route, Table2, TrendingUp, Trophy, Wallet } from 'lucide-vue-next'
import type { DayRecord } from '../services/types'
import { aggregate, summarize, type Granularity } from '../utils/stats'
import { money } from '../utils/format'

const days = ref<DayRecord[]>([])
const categoryOrder = ref<string[]>([])
const granularity = ref<Granularity>('day')
const table = ref(false)
const selected = ref<string | null>(null)

async function load() {
  const taurus = await useTaurus()
  days.value = await taurus.repo.listDays()
  categoryOrder.value = (await taurus.repo.listCategories()).map(category => category.id)
}
onMounted(load)
onActivated(load)

const MODES = [['day', 'Día'], ['month', 'Mes'], ['year', 'Año']] as const
const LIMIT: Record<Granularity, number> = { day: 14, month: 12, year: 10 }
const KEYLEN: Record<Granularity, number> = { day: 10, month: 7, year: 4 }
const buckets = computed(() => aggregate(days.value, granularity.value).slice(-LIMIT[granularity.value]))
const periodSummary = computed(() => {
  const keys = new Set(buckets.value.map(bucket => bucket.key))
  return summarize(days.value.filter(day => keys.has(day.date.slice(0, KEYLEN[granularity.value]))))
})

// Color por entidad: Neto = serie 1; cada categoría conserva su serie según su id.
const slot = (id: string) => Math.min(2 + Math.max(categoryOrder.value.indexOf(id), 0), 8)
interface BarSegment { label: string; value: number; color: string }
const barSegments = (bucket: (typeof buckets.value)[number]): BarSegment[] => [
  { label: 'Neto', value: Math.max(bucket.net, 0), color: 'var(--s1)' },
  { label: 'Comisión inDrive', value: bucket.commission, color: 'var(--neg)' },
  ...[...bucket.costs.entries()]
    .sort((first, second) => slot(first[0]) - slot(second[0]))
    .map(([id, cost]) => ({ label: cost.name, value: cost.amount, color: `var(--s${slot(id)})` })),
]

const legend = computed(() => {
  const seen = new Map<string, string>([['Neto', 'var(--s1)']])
  if (buckets.value.some(bucket => bucket.commission > 0)) seen.set('Comisión inDrive', 'var(--neg)')
  for (const bucket of buckets.value) for (const [id, cost] of bucket.costs) seen.set(cost.name, `var(--s${slot(id)})`)
  return [...seen.entries()]
})

// Geometría
const CHART_WIDTH = 340, CHART_HEIGHT = 210, PAD_LEFT = 40, PAD_TOP = 14, PAD_BOTTOM = 28
const plotWidth = CHART_WIDTH - PAD_LEFT - 8, plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM
const maxValue = computed(() => {
  const largest = Math.max(0, ...buckets.value.map(bucket => barSegments(bucket).reduce((total, segment) => total + segment.value, 0)))
  if (largest === 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(largest))
  return Math.ceil(largest / magnitude / 2) * magnitude * 2
})
const ticks = computed(() => [0, 0.5, 1].map(fraction => fraction * maxValue.value))
const scaleY = (value: number) => PAD_TOP + plotHeight - (value / maxValue.value) * plotHeight
const slotWidth = computed(() => plotWidth / Math.max(buckets.value.length, 1))
const barWidth = computed(() => Math.min(24, slotWidth.value * 0.7))

function formatCompact(amount: number) {
  if (amount >= 1e6) return `${+(amount / 1e6).toFixed(1)}M`
  if (amount >= 1e3) return `${+(amount / 1e3).toFixed(1)}K`
  return String(Math.round(amount))
}
const label = (key: string) => (granularity.value === 'day' ? key.slice(8) : granularity.value === 'month' ? key.slice(5) : key)

/** Rect con esquinas superiores redondeadas (4px) y base recta. */
function buildBarPath(left: number, top: number, height: number, width: number, round: boolean) {
  const radius = round ? Math.min(4, height, width / 2) : 0
  return `M${left},${top + height}V${top + radius}Q${left},${top} ${left + radius},${top}H${left + width - radius}Q${left + width},${top} ${left + width},${top + radius}V${top + height}Z`
}

function buildRects(bucket: (typeof buckets.value)[number], bucketIndex: number) {
  const left = PAD_LEFT + bucketIndex * slotWidth.value + (slotWidth.value - barWidth.value) / 2
  let accumulated = 0
  const items = barSegments(bucket).filter(segment => segment.value > 0)
  return items.map((segment, segmentIndex) => {
    const top = scaleY(accumulated + segment.value)
    const height = scaleY(accumulated) - top
    accumulated += segment.value
    return { path: buildBarPath(left, top, Math.max(height - 2, 1), barWidth.value, segmentIndex === items.length - 1), color: segment.color }
  })
}

const selectedBucket = computed(() => buckets.value.find(bucket => bucket.key === selected.value) ?? null)
// Cambiar de rango reinicia la animación de crecimiento de las barras.
const chartKey = computed(() => `${granularity.value}-${buckets.value.length}`)
</script>

<template>
  <section class="stack">
    <div class="seg" :style="{ '--n': 3, '--i': MODES.findIndex(mode => mode[0] === granularity) }">
      <span class="thumb" />
      <button v-for="[modeKey, modeLabel] in MODES" :key="modeKey" :class="{ active: granularity === modeKey }" @click="granularity = modeKey; selected = null">{{ modeLabel }}</button>
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
          <p class="hero-value" :class="periodSummary.net >= 0 ? 'pos' : 'neg'"><AnimatedNumber :value="periodSummary.net" /></p>
          <p class="muted small">{{ periodSummary.days }} {{ periodSummary.days === 1 ? 'día' : 'días' }} en el período</p>
        </div>
        <div class="card tile">
          <span class="icon-tile info"><Wallet :size="18" /></span>
          <span class="muted small">Bruto</span><b class="num">{{ money(periodSummary.gross) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile neg"><CircleDollarSign :size="18" /></span>
          <span class="muted small">Costos</span><b class="num">{{ money(periodSummary.totalCost) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile neg"><CircleDollarSign :size="18" /></span>
          <span class="muted small">Comisión inDrive + IVA</span><b class="num">{{ money(periodSummary.commission) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile pos"><Gauge :size="18" /></span>
          <span class="muted small">Neto por día</span><b class="num">{{ money(periodSummary.avgNet) }}</b>
        </div>
        <div class="card tile">
          <span class="icon-tile"><Route :size="18" /></span>
          <span class="muted small">{{ Math.round(periodSummary.km) }} km · neto/km</span><b class="num">{{ money(periodSummary.netPerKm) }}</b>
        </div>
        <div class="card tile wide">
          <span class="icon-tile"><Trophy :size="18" /></span>
          <div>
            <span class="muted small">Mejor día</span>
            <b class="num block">{{ periodSummary.best ? money(periodSummary.best.net) : '—' }}</b>
          </div>
          <span v-if="periodSummary.best" class="muted small best-date">{{ periodSummary.best.date }}</span>
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

        <svg v-if="!table" :key="chartKey" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="Ingreso bruto por período, dividido en neto y costos">
          <g v-for="tick in ticks" :key="tick">
            <line :x1="PAD_LEFT" :x2="CHART_WIDTH - 8" :y1="scaleY(tick)" :y2="scaleY(tick)" class="grid" />
            <text :x="PAD_LEFT - 6" :y="scaleY(tick) + 4" class="tick" text-anchor="end">{{ formatCompact(tick) }}</text>
          </g>
          <g v-for="(bucket, i) in buckets" :key="bucket.key" class="col" @click="selected = selected === bucket.key ? null : bucket.key">
            <rect :x="PAD_LEFT + i * slotWidth" :y="PAD_TOP" :width="slotWidth" :height="plotHeight" fill="transparent" />
            <g class="bar" :style="{ animationDelay: i * 35 + 'ms', opacity: selected && selected !== bucket.key ? 0.35 : 1 }">
              <path v-for="(rect, rectIndex) in buildRects(bucket, i)" :key="rectIndex" :d="rect.path" :fill="rect.color" />
            </g>
            <text :x="PAD_LEFT + i * slotWidth + slotWidth / 2" :y="CHART_HEIGHT - 10" class="tick" :class="{ sel: selected === bucket.key }" text-anchor="middle">{{ label(bucket.key) }}</text>
          </g>
        </svg>

        <div v-else class="table-wrap">
          <table>
            <thead><tr><th>Período</th><th>Bruto</th><th>Costos</th><th>Comisión</th><th>Neto</th><th>Km</th></tr></thead>
            <tbody>
              <tr v-for="bucket in buckets" :key="bucket.key">
                <td>{{ bucket.key }}</td><td>{{ money(bucket.gross) }}</td><td>{{ money(bucket.totalCost) }}</td><td>{{ money(bucket.commission) }}</td><td>{{ money(bucket.net) }}</td><td>{{ Math.round(bucket.km) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Transition name="page">
          <div v-if="selectedBucket && !table" class="tip">
            <b>{{ selectedBucket.key }}</b>
            <div v-for="segment in barSegments(selectedBucket)" :key="segment.label"><span><i :style="{ background: segment.color }" />{{ segment.label }}</span><b class="num">{{ money(segment.value) }}</b></div>
            <div class="total"><span>Bruto</span><b class="num">{{ money(selectedBucket.gross) }}</b></div>
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
