<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { useChartTheme } from '../../composables/useChartTheme'
import { BAR_RADIUS, categoryAxis, chartGrid, legendTop, smoothLine, tooltipCard, valueAxis } from '../../utils/chartOptions'
import type { IncomeSeries } from '../../utils/chartSeries'
import { money } from '../../utils/format'
import ChartCanvas from './ChartCanvas.vue'

/** Bruto apilado por medio de pago (uno por entrada del catálogo) más líneas de neto y neto tras gastos, por periodo. */
const props = defineProps<{
  labels: string[]
  income: IncomeSeries[]
  net: number[]
  netAfterExpenses: number[]
}>()

const { palette, baseOption, axisPointer } = useChartTheme()
// Posiciones de la paleta para las barras. Las líneas: «Neto» sólida con el acento y «Neto tras gastos» discontinua en tono neutro.
const BAR_COLOR_INDEXES = [0, 6, 2, 3, 4, 5]

interface AxisItem { axisValueLabel: string; color: string; seriesName: string; value: number | null }

// Un periodo sin ningún movimiento (bruto, neto y neto tras gastos en 0) no dibuja punto: queda un hueco en vez de una caída a 0.
const hasActivity = (index: number) => props.income.some(series => (series.data[index] ?? 0) !== 0) || props.net[index] !== 0 || props.netAfterExpenses[index] !== 0
const activeOnly = (values: number[]) => values.map((value, index) => (hasActivity(index) ? value : null))

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  return {
    ...baseOption.value,
    grid: chartGrid(56),
    legend: legendTop(colors),
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'axis',
      axisPointer: axisPointer.value,
      formatter: (items: AxisItem[]) => tooltipCard({
        title: items[0]?.axisValueLabel ?? '',
        rows: items.filter(item => typeof item.value === 'number').map(item => ({ color: item.color, label: item.seriesName, value: money(item.value!) })),
      }),
    },
    xAxis: categoryAxis(colors, props.labels),
    yAxis: valueAxis(colors),
    series: [
      ...props.income.map((series, index) => ({
        name: series.name, type: 'bar', stack: 'gross', data: series.data, barMaxWidth: 36,
        color: colors.series[BAR_COLOR_INDEXES[index % BAR_COLOR_INDEXES.length]! % colors.series.length],
        itemStyle: { borderColor: colors.surface, borderWidth: 1, ...(index === props.income.length - 1 ? { borderRadius: [BAR_RADIUS, BAR_RADIUS, 0, 0] } : {}) },
        emphasis: { focus: 'series' },
      })),
      smoothLine(colors, 'Neto', activeOnly(props.net), colors.accent),
      smoothLine(colors, 'Neto tras gastos', activeOnly(props.netAfterExpenses), colors.textSecondary, { dashed: true }),
    ],
  }
})
</script>

<template>
  <div class="chart-wrap">
    <ChartCanvas v-if="labels.length" :option="option" />
    <p v-else class="chart-empty muted small">Aún no hay periodos para graficar.</p>
  </div>
</template>

<style scoped>
.chart-wrap { height: 300px; }
.chart-empty { display: grid; place-items: center; height: 100%; text-align: center; }
</style>
