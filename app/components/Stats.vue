<script setup lang="ts">
import { ChartColumn, ChevronDown, CircleDollarSign, Filter, Clock, Gauge, Hourglass, Percent, Receipt, Route, Timer, TrendingUp, Wallet, Sunrise } from 'lucide-vue-next'
import type { DayRecord, ShiftTemplate } from '../services/types'
import { clockNow, withShiftOnlyDays } from '../utils/shifts'
import { ALL_SHIFTS_KEY, buildShiftBreakdown, dropStaleOpenShifts, filterDaysByShift, shiftFilterOptions, type ShiftBreakdownRow } from '../utils/shiftStats'
import { ALL_WEEKDAYS_KEY, buildShiftWeekdayGrid, filterByWeekday, WEEKDAY_SHORT_NAMES, weekdayFilterOptions, WEEKDAY_NAMES } from '../utils/shiftWeekday'
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
const ShiftWeekdayHeatmap = defineAsyncComponent(() => import('./charts/ShiftWeekdayHeatmap.vue'))

// Gráficas (ECharts, componentes en ./charts): income ← chartSeries; costs ← costSeries; activity ← activityRows + hourlyMinutes.
const days = ref<DayRecord[]>([])
const expenses = ref<StatsExpense[]>([])
const templates = ref<ShiftTemplate[]>([])
const shiftFilter = ref(ALL_SHIFTS_KEY)
const weekdayFilter = ref(ALL_WEEKDAYS_KEY)
const weekdayView = ref<'map' | 'table'>('map')
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
    // Gastos varios = movimientos de caja cuyo tipo lleva categoría, de cualquier cuenta.
    expenses.value = (await taurus.repo.listCash()).flatMap(cashDay =>
      cashDay.movements
        .filter(movement => movementTypeHasCategory(catalogs.value.movementTypes, movement.type))
        .map(movement => ({ date: cashDay.date, amount: movement.amount, categoryId: movement.categoryId })))
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
// Si el turno elegido ya no tiene datos, el filtro vuelve a «Todos».
const activeFilter = computed(() => (filterOptions.value.some(option => option.key === shiftFilter.value) ? shiftFilter.value : ALL_SHIFTS_KEY))
const isFiltered = computed(() => activeFilter.value !== ALL_SHIFTS_KEY)
const isWeekdayFiltered = computed(() => weekdayFilter.value !== ALL_WEEKDAYS_KEY)
const weekdayName = computed(() => WEEKDAY_NAMES[Number(weekdayFilter.value) - 1] ?? '')
const weekdayOptions = weekdayFilterOptions()
// El periodo (qué buckets entran) se define con todos los datos, para que el filtro no corra la ventana.
const periodBuckets = computed(() => aggregate(allDays.value, granularity.value, expenses.value, statsOptions.value).slice(-LIMIT[granularity.value]))
const periodKeys = computed(() => new Set(periodBuckets.value.map(bucket => bucket.key)))
const inPeriod = (date: string) => periodKeys.value.has(bucketKey(date, granularity.value))
// Todos los días del periodo, sin filtros: base del mapa Turno × día de la semana, que compara ambas dimensiones.
const periodDaysUnfiltered = computed(() => allDays.value.filter(day => inPeriod(day.date)))
// El día de la semana sale de la fecha de cada día; con uno elegido solo cuentan esos días (y sus gastos varios, que también tienen fecha).
const periodDaysAll = computed(() => filterByWeekday(periodDaysUnfiltered.value, weekdayFilter.value))
// Con un turno elegido solo cuentan sus viajes y horas; km extra y gastos varios de caja quedan fuera (ver `filterDaysByShift`).
const periodDays = computed(() => filterDaysByShift(periodDaysAll.value, templates.value, activeFilter.value))
const periodExpenses = computed(() => (isFiltered.value ? [] : filterByWeekday(expenses.value.filter(expense => inPeriod(expense.date)), weekdayFilter.value)))
const buckets = computed(() => (isFiltered.value || isWeekdayFiltered.value ? aggregate(periodDays.value, granularity.value, periodExpenses.value, statsOptions.value) : periodBuckets.value))
const periodSummary = computed(() => summarize(periodDays.value, periodExpenses.value, statsOptions.value))

const activityDays = periodDays
const activity = computed(() => {
  const currentTime = clockNow()
  const perDay = activityDays.value.map(day => dayActivity(day.services, day.shifts ?? [], currentTime))
  return { ...periodActivity(perDay), longestGap: perDay.reduce((longest, day) => Math.max(longest, day.longestGap), 0) }
})
const shiftRows = computed<ShiftBreakdownRow[]>(() => buildShiftBreakdown(periodDaysAll.value, templates.value, clockNow()))
const weekdayGrid = computed(() => buildShiftWeekdayGrid(periodDaysUnfiltered.value, templates.value, clockNow()))
const shiftColumns = ['Turno', 'Viajes', 'Bruto', 'Neto', 'Km', 'Horas de turno', 'Neto/hora de turno', '% aprovechamiento']
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
      <label v-if="days.length" class="field shift-filter">
        <span>Turno</span>
        <div class="select">
          <select v-model="shiftFilter" class="input" aria-label="Filtrar estadísticas por turno" data-filter="shift">
            <option v-for="option in filterOptions" :key="option.key" :value="option.key">{{ option.name }}</option>
          </select>
          <ChevronDown :size="18" />
        </div>
      </label>
      <label v-if="days.length" class="field weekday-filter">
        <span>Día de la semana</span>
        <div class="select">
          <select v-model="weekdayFilter" class="input" aria-label="Filtrar estadísticas por día de la semana" data-filter="weekday">
            <option v-for="option in weekdayOptions" :key="option.key" :value="option.key">{{ option.name }}</option>
          </select>
          <ChevronDown :size="18" />
        </div>
      </label>
    </div>
    <div v-if="isWeekdayFiltered" class="notice info" role="status" data-notice="weekday-filter">
      <Filter :size="18" />
      <div>
        <b>Solo cuentan los días {{ weekdayName.toLowerCase() }}</b>
        <p class="small">El día de la semana sale de la fecha de cada día. Los gastos varios de caja se cuentan por la fecha en que se hicieron; el mapa «Turno × día de la semana» siempre muestra todos los días.</p>
      </div>
    </div>
    <div v-if="isFiltered" class="notice info" role="status" data-notice="shift-filter">
      <Filter :size="18" />
      <div>
        <b>Solo cuentan los viajes y las horas de este turno</b>
        <p class="small">El km extra del día y los gastos varios de caja no se reparten entre turnos, así que no se incluyen aquí. Los costos por km se calculan con los km de los viajes del turno.</p>
      </div>
    </div>

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
            <div v-if="shiftRows.length" class="table-wrap">
              <table class="shift-table">
                <thead>
                  <tr><th v-for="column in shiftColumns" :key="column">{{ column }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in shiftRows" :key="row.key">
                    <td>{{ row.name }}</td><td>{{ row.trips }}</td><td>{{ money(row.gross) }}</td>
                    <td :class="row.net < 0 ? 'neg' : ''">{{ money(row.net) }}</td><td>{{ Math.round(row.km) }}</td>
                    <td>{{ row.shiftMinutes > 0 ? duration(row.shiftMinutes) : '—' }}</td>
                    <td v-if="row.netPerShiftHour === null">—</td>
                    <td v-else :class="row.netPerShiftHour < 0 ? 'neg' : ''">{{ money(row.netPerShiftHour) }}</td>
                    <td>{{ row.utilization === null ? '—' : percent(row.utilization) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">Aún no hay viajes ni turnos en este periodo.</p>
          </div>

          <div class="card chart-card" data-card="shift-weekday">
            <div class="row between">
              <span class="title">Turno × día de la semana</span>
              <div class="seg view-toggle" :style="{ '--n': 2, '--i': weekdayView === 'map' ? 0 : 1 }" role="group" aria-label="Vista del turno por día de la semana">
                <span class="thumb" />
                <button type="button" :class="{ active: weekdayView === 'map' }" @click="weekdayView = 'map'">Mapa</button>
                <button type="button" :class="{ active: weekdayView === 'table' }" @click="weekdayView = 'table'">Tabla</button>
              </div>
            </div>
            <p class="muted small">Neto por hora de turno de cada turno habitual según el día de la semana (de la fecha del día), sin importar los filtros. Las celdas vacías no tuvieron ese turno; los viajes sin turno no entran.</p>
            <div v-if="weekdayView === 'map'" data-chart="shift-weekday" class="chart" role="img" aria-label="Neto por hora de turno según turno y día de la semana">
              <ShiftWeekdayHeatmap :rows="weekdayGrid" />
            </div>
            <div v-else-if="weekdayGrid.length" class="table-wrap">
              <table class="weekday-table">
                <thead>
                  <tr><th>Turno</th><th v-for="name in WEEKDAY_SHORT_NAMES" :key="name">{{ name }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in weekdayGrid" :key="row.key">
                    <td>{{ row.name }}</td>
                    <td v-for="(cell, index) in row.cells" :key="index" :class="cell && cell.netPerShiftHour !== null && cell.netPerShiftHour < 0 ? 'neg' : ''">
                      <template v-if="cell && cell.netPerShiftHour !== null">{{ money(cell.netPerShiftHour) }}/h<span class="muted small block">{{ cell.trips }} {{ cell.trips === 1 ? 'viaje' : 'viajes' }} · {{ duration(cell.shiftMinutes) }}</span></template>
                      <template v-else>—</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="muted small">Aún no hay turnos en este periodo.</p>
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
.shift-filter, .weekday-filter { width: 280px; max-width: 100%; }
.view-toggle { width: 180px; }
.notice p { margin-top: 2px; }
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
