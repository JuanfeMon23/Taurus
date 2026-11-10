<script setup lang="ts">
import { ChartColumn, CircleDollarSign, Clock, Gauge, Hourglass, Percent, Receipt, Route, Timer, TrendingUp, Wallet, Sunrise } from 'lucide-vue-next'
import type { DayRecord, ShiftTemplate } from '../services/types'
import { clockNow, withShiftOnlyDays } from '../utils/shifts'
import { ALL_SHIFTS_KEY, buildShiftBreakdown, dropStaleOpenShifts, filterDaysByShift, shiftFilterOptions, type ShiftBreakdownRow } from '../utils/shiftStats'
import { buildActivityRows, buildCostSeries, buildIncomeSeries, type ActivityDay } from '../utils/chartSeries'
import { entryName, movementTypeHasCategory } from '../utils/catalogs'
import { dayActivity, periodActivity } from '../utils/activity'
import { toUserMessage } from '../utils/errors'
import { money, todayISO } from '../utils/format'
import { methodIcon } from '../utils/icons'
import { aggregate, bucketKey, summarize, UNCATEGORIZED_EXPENSE, type Granularity, type StatsExpense } from '../utils/stats'
import { formatDuration } from '../utils/trip'

// Carga diferida: ECharts queda fuera del entry y se descarga al abrir Estadísticas.
const ActivityTimeline = defineAsyncComponent(() => import('./charts/ActivityTimeline.vue'))
const CostsChart = defineAsyncComponent(() => import('./charts/CostsChart.vue'))
const HourlyActivityChart = defineAsyncComponent(() => import('./charts/HourlyActivityChart.vue'))
const IncomeChart = defineAsyncComponent(() => import('./charts/IncomeChart.vue'))
const ShiftCompareChart = defineAsyncComponent(() => import('./charts/ShiftCompareChart.vue'))

// Gráficas (ECharts, componentes en ./charts): income ← chartSeries; costs ← costSeries; activity ← activityRows + hourlyMinutes.
const days = ref<DayRecord[]>([])
const expenses = ref<StatsExpense[]>([])
const templates = ref<ShiftTemplate[]>([])
const shiftFilter = ref(ALL_SHIFTS_KEY)
const granularity = ref<Granularity>('day')
const loadError = ref<string | null>(null)
const { catalogs, defaultMethod, refreshCatalogs } = useCatalogs()

async function load() {
  try {
    const taurus = await useTaurus()
    await refreshCatalogs()
    templates.value = await taurus.repo.listShiftTemplates({ includeInactive: true })
    // Los días con turnos y sin viajes cuentan (100 % tiempo muerto); sus montos son 0.
    days.value = withShiftOnlyDays(await taurus.repo.listDays(), (await taurus.snapshot()).shifts.filter(shift => !shift.deleted))
    // Gastos varios = movimientos de caja cuyo tipo lleva categoría, con cualquier medio de pago.
    expenses.value = (await taurus.repo.listCash()).flatMap(cashDay =>
      cashDay.movements
        .filter(movement => movementTypeHasCategory(catalogs.value.movementTypes, movement.type))
        .map(movement => ({ date: cashDay.date, amount: movement.amount, categoryId: movement.categoryId, method: movement.method })))
    loadError.value = null
  } catch (error) {
    loadError.value = toUserMessage(error)
  }
}
onMounted(load)
onActivated(load)

const MODES = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']] as const
const LIMIT: Record<Granularity, number> = { day: 30, week: 12, month: 12, year: 10 }

const statsOptions = computed(() => ({ defaultMethodId: defaultMethod.value }))
// Un turno en curso solo cuenta (hasta la hora actual) en el día de hoy; en días pasados se ignora.
const allDays = computed(() => dropStaleOpenShifts(days.value, todayISO()))
const filterOptions = computed(() => shiftFilterOptions(allDays.value, templates.value))
const filterItems = computed(() => filterOptions.value.map(option => ({ label: option.name, value: option.key })))
// Si el turno elegido ya no tiene datos, el filtro vuelve a «Todos».
const activeFilter = computed(() => (filterOptions.value.some(option => option.key === shiftFilter.value) ? shiftFilter.value : ALL_SHIFTS_KEY))
const isFiltered = computed(() => activeFilter.value !== ALL_SHIFTS_KEY)
// El periodo (qué buckets entran) se define con todos los datos, para que el filtro no corra la ventana.
const periodBuckets = computed(() => aggregate(allDays.value, granularity.value, expenses.value, statsOptions.value).slice(-LIMIT[granularity.value]))
const periodKeys = computed(() => new Set(periodBuckets.value.map(bucket => bucket.key)))
const inPeriod = (date: string) => periodKeys.value.has(bucketKey(date, granularity.value))
const periodDaysAll = computed(() => allDays.value.filter(day => inPeriod(day.date)))
// Con un turno elegido solo cuentan sus viajes y horas; km extra y gastos varios de caja quedan fuera (ver `filterDaysByShift`).
const periodDays = computed(() => filterDaysByShift(periodDaysAll.value, templates.value, activeFilter.value))
const buckets = computed(() => (isFiltered.value ? aggregate(periodDays.value, granularity.value, [], statsOptions.value) : periodBuckets.value))
const periodSummary = computed(() => summarize(periodDays.value, isFiltered.value ? [] : expenses.value.filter(expense => inPeriod(expense.date)), statsOptions.value))

const activityDays = periodDays
const activity = computed(() => {
  const currentTime = clockNow()
  const perDay = activityDays.value.map(day => dayActivity(day.services, day.shifts ?? [], currentTime))
  return { ...periodActivity(perDay), longestGap: perDay.reduce((longest, day) => Math.max(longest, day.longestGap), 0) }
})
const shiftRows = computed<ShiftBreakdownRow[]>(() => buildShiftBreakdown(periodDaysAll.value, templates.value, clockNow()))
const shiftColumns = [
  { accessorKey: 'name', header: 'Turno' }, { accessorKey: 'trips', header: 'Viajes' }, { accessorKey: 'gross', header: 'Bruto' },
  { accessorKey: 'net', header: 'Neto' }, { accessorKey: 'km', header: 'Km' }, { accessorKey: 'shiftMinutes', header: 'Horas de turno' },
  { accessorKey: 'netPerShiftHour', header: 'Neto/hora de turno' }, { accessorKey: 'utilization', header: '% aprovechamiento' },
]
const netPerHourItems = computed(() => shiftRows.value.map(row => ({ key: row.key, name: row.name, value: row.netPerShiftHour })))
const netTotalItems = computed(() => shiftRows.value.map(row => ({ key: row.key, name: row.name, value: row.net })))
const hourlyMinutes = computed(() => activity.value.hourlyActivity)
const hourlyShiftMinutes = computed(() => activity.value.hourlyShiftMinutes)
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const duration = (minutes: number) => formatDuration(Math.round(minutes)) || '0 min'
const percent = (fraction: number) => `${Math.round(fraction * 100)} %`

const chartSeries = computed(() => ({
  labels: buckets.value.map(bucket => bucket.key),
  gross: buckets.value.map(bucket => bucket.gross),
  net: buckets.value.map(bucket => bucket.net),
  netAfterExpenses: buckets.value.map(bucket => bucket.netAfterExpenses),
  income: buildIncomeSeries(buckets.value, catalogs.value.paymentMethods),
  costs: buckets.value.map(bucket => bucket.totalCost),
  commission: buckets.value.map(bucket => bucket.commission),
  expenses: buckets.value.map(bucket => bucket.expenses),
}))

const costSeries = computed(() => buildCostSeries(buckets.value))
const expensesByCategory = computed(() => [...periodSummary.value.expensesByCategory]
  .map(([categoryId, amount]) => ({ categoryId, name: categoryId === UNCATEGORIZED_EXPENSE ? UNCATEGORIZED_EXPENSE : entryName(catalogs.value.expenseCategories, categoryId), amount }))
  .sort((first, second) => second.amount - first.amount))
// En «Día» la línea de tiempo muestra el último día trabajado en grande; en el resto, una fila por día trabajado.
const activityRows = computed(() => buildActivityRows(activityDays.value, granularity.value === 'day' ? 'latest' : 'all', clockNow()))

const netPerKm = (bucket: { net: number; km: number }) => (bucket.km ? bucket.net / bucket.km : 0)
const tableRows = computed(() => [...buckets.value].reverse())

const summaryCards = computed(() => allSummaryCards.value.filter(card => !(isFiltered.value && (card.key === 'expenses' || card.key === 'netAfterExpenses'))))
const allSummaryCards = computed(() => [
  { key: 'gross', label: 'Bruto', value: money(periodSummary.value.gross), icon: Wallet, tone: 'info' },
  { key: 'commission', label: 'Comisión inDrive + IVA', value: money(periodSummary.value.commission), icon: Receipt, tone: 'neg' },
  { key: 'costs', label: 'Costos', value: money(periodSummary.value.totalCost), icon: CircleDollarSign, tone: 'neg' },
  { key: 'expenses', label: 'Gastos varios', value: money(periodSummary.value.expenses), icon: Receipt, tone: 'neg' },
  { key: 'net', label: 'Neto', value: money(periodSummary.value.net), icon: TrendingUp, tone: periodSummary.value.net >= 0 ? 'pos' : 'neg' },
  { key: 'netAfterExpenses', label: 'Neto después de gastos', value: money(periodSummary.value.netAfterExpenses), icon: TrendingUp, tone: periodSummary.value.netAfterExpenses >= 0 ? 'pos' : 'neg' },
  { key: 'netPerKm', label: `Neto/km · ${Math.round(periodSummary.value.km)} km`, value: money(periodSummary.value.netPerKm), icon: Route, tone: '' },
  ...chartSeries.value.income.map(series => {
    const affectsCash = catalogs.value.paymentMethods.find(method => method.id === series.id)?.affectsCash ?? true
    return { key: `income-${series.id}`, label: series.name, value: money(periodSummary.value.incomeByMethod.get(series.id) ?? 0), icon: methodIcon(series.id, affectsCash), tone: affectsCash ? 'pos' : 'info' }
  }),
])

const hasShiftMetrics = computed(() => activity.value.shiftMinutes > 0)
const activityIndicators = computed(() => [
  ...(hasShiftMetrics.value
    ? [
        { key: 'shift', label: 'Horas en turno', value: duration(activity.value.shiftMinutes), icon: Clock },
        { key: 'activeInShift', label: 'Activo en turno', value: duration(activity.value.activeInShiftMinutes), icon: Gauge },
        { key: 'idle', label: 'Tiempo muerto (en turno)', value: duration(activity.value.idleMinutes), icon: Hourglass },
      ]
    : [
        { key: 'active', label: 'Horas activas', value: duration(activity.value.activeMinutes), icon: Clock },
        { key: 'idle', label: 'Horas muertas', value: duration(activity.value.idleMinutes), icon: Hourglass },
      ]),
  { key: 'utilization', label: '% aprovechamiento', value: percent(activity.value.utilization), icon: Percent },
  ...(hasShiftMetrics.value ? [{ key: 'outOfShift', label: 'Viajes fuera de turno', value: String(activity.value.outOfShiftTripCount), icon: Route }] : []),
  { key: 'gap', label: 'Hueco más largo', value: duration(activity.value.longestGap), icon: Timer },
  { key: 'best', label: 'Mejor franja horaria', value: activity.value.bestHour === null ? '—' : `${hourLabel(activity.value.bestHour)} – ${hourLabel((activity.value.bestHour + 1) % 24)}`, icon: Sunrise },
])
</script>

<template>
  <section class="stack">
    <div class="toolbar">
    <div class="seg modes" :style="{ '--n': 4, '--i': MODES.findIndex(mode => mode[0] === granularity) }" role="group" aria-label="Agrupar por">
      <span class="thumb" />
      <button v-for="[modeKey, modeLabel] in MODES" :key="modeKey" type="button" :class="{ active: granularity === modeKey }" @click="granularity = modeKey">{{ modeLabel }}</button>
    </div>
      <UFormField v-if="days.length" label="Turno" class="shift-filter">
        <USelect v-model="shiftFilter" :items="filterItems" value-key="value" label-key="label" class="w-full" aria-label="Filtrar estadísticas por turno" data-filter="shift" />
      </UFormField>
    </div>
    <UAlert v-if="isFiltered" color="info" variant="subtle" icon="i-lucide-filter" data-notice="shift-filter"
      title="Solo cuentan los viajes y las horas de este turno"
      description="El km extra del día y los gastos varios de caja no se reparten entre turnos, así que no se incluyen aquí. Los costos por km se calculan con los km de los viajes del turno." />

    <p v-if="loadError" class="err" role="alert">{{ loadError }}</p>

    <div v-if="!days.length" class="card empty">
      <ChartColumn :size="40" />
      <b>Sin datos todavía</b>
      <p class="small">Registra días para ver tus estadísticas.</p>
    </div>

    <template v-else>
      <div class="cards rise">
        <div v-for="card in summaryCards" :key="card.key" class="card tile" :data-card="card.key">
          <span class="icon-tile" :class="card.tone"><component :is="card.icon" :size="18" /></span>
          <span class="muted small">{{ card.label }}</span>
          <b class="num value" :class="card.tone === 'neg' && (card.key === 'net' || card.key === 'netAfterExpenses') ? 'neg' : ''">{{ card.value }}</b>
        </div>
      </div>

      <div class="layout">
        <div class="stack main-col">
          <!-- Gráficas: ECharts se monta en estos contenedores (ver comentario del script). -->
          <div class="charts">
            <div class="card chart-card">
              <span class="title">Ingresos y neto</span>
              <div data-chart="income" class="chart" role="img" aria-label="Ingreso bruto, neto y neto después de gastos por periodo">
                <IncomeChart :labels="chartSeries.labels" :income="chartSeries.income" :net="chartSeries.net" :net-after-expenses="chartSeries.netAfterExpenses" />
              </div>
            </div>
            <div class="card chart-card">
              <span class="title">Costos, comisión y gastos</span>
              <div data-chart="costs" class="chart" role="img" aria-label="Costos, comisión y gastos varios por periodo">
                <CostsChart :costs="costSeries" />
              </div>
            </div>
          </div>

          <div class="card chart-card">
            <span class="title">Línea de tiempo de actividad</span>
            <p class="muted small">{{ granularity === 'day' ? 'Último día trabajado' : 'Un renglón por día trabajado' }}: cada viaje va de la recogida a la llegada; las bandas son turnos y los puntos, tiempo muerto dentro de turno.</p>
            <div data-chart="timeline" class="chart" role="img" aria-label="Línea de tiempo de viajes y tiempo muerto por día">
              <ActivityTimeline :rows="activityRows" :single="granularity === 'day'" />
            </div>
          </div>

          <div class="card stack" data-card="shift-breakdown">
            <span class="title">Desglose por turno</span>
            <p class="muted small">Por turno habitual del periodo, sin importar el filtro. Neto por hora = neto / horas de turno. Los viajes sin turno y los turnos sueltos van en filas aparte.</p>
            <UTable v-if="shiftRows.length" :data="shiftRows" :columns="shiftColumns" class="shift-table" :ui="{ th: 'text-right first:text-left', td: 'text-right first:text-left tabular-nums whitespace-nowrap' }">
              <template #gross-cell="{ row }">{{ money(row.original.gross) }}</template>
              <template #net-cell="{ row }"><span :class="row.original.net < 0 ? 'neg' : ''">{{ money(row.original.net) }}</span></template>
              <template #km-cell="{ row }">{{ Math.round(row.original.km) }}</template>
              <template #shiftMinutes-cell="{ row }">{{ row.original.shiftMinutes > 0 ? duration(row.original.shiftMinutes) : '—' }}</template>
              <template #netPerShiftHour-cell="{ row }">
                <span v-if="row.original.netPerShiftHour === null">—</span>
                <span v-else :class="row.original.netPerShiftHour < 0 ? 'neg' : ''">{{ money(row.original.netPerShiftHour) }}</span>
              </template>
              <template #utilization-cell="{ row }">{{ row.original.utilization === null ? '—' : percent(row.original.utilization) }}</template>
            </UTable>
            <p v-else class="muted small">Aún no hay viajes ni turnos en este periodo.</p>
          </div>

          <div class="charts">
            <div class="card chart-card">
              <span class="title">Neto por hora de turno</span>
              <div data-chart="shift-hourly" class="chart" role="img" aria-label="Neto por hora de turno, comparado entre turnos">
                <ShiftCompareChart :items="netPerHourItems" metric-label="Neto por hora de turno" unit="/h" />
              </div>
            </div>
            <div class="card chart-card">
              <span class="title">Neto total por turno</span>
              <div data-chart="shift-net" class="chart" role="img" aria-label="Neto total del periodo, comparado entre turnos">
                <ShiftCompareChart :items="netTotalItems" metric-label="Neto total" />
              </div>
            </div>
          </div>

          <div v-if="expensesByCategory.length" class="card stack" data-card="expenses-by-category">
            <span class="title">Gastos varios por categoría</span>
            <div class="category-list">
              <div v-for="category in expensesByCategory" :key="category.categoryId" class="row between"><span>{{ category.name }}</span><b class="num">{{ money(category.amount) }}</b></div>
            </div>
          </div>

          <div class="card stack">
            <span class="title">Detalle por periodo</span>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Periodo</th><th>Bruto</th><th>Comisión</th><th>Costos</th><th v-if="!isFiltered">Gastos varios</th><th>Neto</th>
                    <th v-if="!isFiltered">Neto tras gastos</th><th>Neto/km</th><th v-for="series in chartSeries.income" :key="series.id">{{ series.name }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="bucket in tableRows" :key="bucket.key">
                    <td>{{ bucket.key }}</td><td>{{ money(bucket.gross) }}</td><td>{{ money(bucket.commission) }}</td>
                    <td>{{ money(bucket.totalCost) }}</td><td v-if="!isFiltered">{{ money(bucket.expenses) }}</td>
                    <td :class="bucket.net < 0 ? 'neg' : ''">{{ money(bucket.net) }}</td>
                    <td v-if="!isFiltered" :class="bucket.netAfterExpenses < 0 ? 'neg' : ''">{{ money(bucket.netAfterExpenses) }}</td>
                    <td>{{ money(netPerKm(bucket)) }}</td><td v-for="series in chartSeries.income" :key="series.id">{{ money(bucket.incomeByMethod.get(series.id) ?? 0) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="card stack side-col" aria-label="Actividad">
          <span class="title">Actividad</span>
          <p class="muted small">{{ activity.workedDays }} {{ activity.workedDays === 1 ? 'día trabajado' : 'días trabajados' }} con horarios registrados</p>
          <p v-if="activity.daysWithoutShifts > 0" class="muted small" data-notice="no-shifts">
            {{ activity.daysWithoutShifts }} {{ activity.daysWithoutShifts === 1 ? 'día sin turnos registrado' : 'días sin turnos registrados' }} (se usa primera recogida → última llegada)
          </p>
          <div class="indicators">
            <div v-for="indicator in activityIndicators" :key="indicator.key" class="indicator" :data-indicator="indicator.key">
              <span class="icon-tile"><component :is="indicator.icon" :size="18" /></span>
              <div><span class="muted small">{{ indicator.label }}</span><b class="num block">{{ indicator.value }}</b></div>
            </div>
          </div>
          <div data-chart="activity" class="chart" role="img" aria-label="Aprovechamiento de los turnos por hora del día" :data-peak="activity.bestHour ?? ''">
            <HourlyActivityChart :hourly-minutes="hourlyMinutes" :hourly-shift-minutes="hourlyShiftMinutes" :best-hour="activity.bestHour" />
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; }
.modes { width: 420px; max-width: 100%; }
.shift-filter { width: 280px; max-width: 100%; }
.neg { color: var(--neg); }
.err { color: var(--neg); font-size: 13px; font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.tile { display: flex; flex-direction: column; gap: 4px; padding: 14px; }
.tile .icon-tile { width: 34px; height: 34px; border-radius: 10px; margin-bottom: 4px; }
.value { font-size: 20px; white-space: nowrap; }
.block { display: block; }
.layout { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
@media (min-width: 1400px) { .layout { grid-template-columns: minmax(0, 1fr) 340px; } .side-col { position: sticky; top: 24px; } }
.charts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
@media (min-width: 1000px) { .charts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.chart-card { display: flex; flex-direction: column; gap: 10px; }
.chart { min-width: 0; }
.indicators { display: flex; flex-direction: column; gap: 10px; }
.indicator { display: flex; align-items: center; gap: 12px; background: var(--surface-2); border-radius: 14px; padding: 10px 12px; }
.indicator .num { font-size: 17px; }
.category-list { display: flex; flex-direction: column; gap: 8px; color: var(--text-2); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: right; padding: 8px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { color: var(--muted); font-weight: 600; }
td { font-variant-numeric: tabular-nums; }
td.neg { color: var(--neg); }
</style>
