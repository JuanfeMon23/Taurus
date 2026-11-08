<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { escapeHtml, useChartTheme } from '../../composables/useChartTheme'
import type { IncomeSeries } from '../../utils/chartSeries'
import { money, moneyCompact } from '../../utils/format'
import ChartCanvas from './ChartCanvas.vue'

/** Bruto apilado por medio de pago (uno por entrada del catálogo) más líneas de neto y neto tras gastos, por periodo. */
const props = defineProps<{
  labels: string[]
  income: IncomeSeries[]
  net: number[]
  netAfterExpenses: number[]
}>()

const { palette, baseOption } = useChartTheme()
// Posiciones de la paleta para las barras (0 y 6 eran efectivo y transferencia; las líneas usan el acento y la 1).
const BAR_COLOR_INDEXES = [0, 6, 2, 3, 4, 5]

interface AxisItem { axisValueLabel: string; marker: string; seriesName: string; value: number }

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const line = (name: string, data: number[], color: string) => ({
    name, type: 'line', data, color, smooth: 0.25, symbol: 'circle', symbolSize: 7, lineStyle: { width: 3 }, z: 5,
  })
  return {
    ...baseOption.value,
    grid: { left: 8, right: 12, top: 44, bottom: 4, containLabel: true },
    legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: colors.textSecondary } },
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: colors.accent, opacity: 0.08 } },
      formatter: (items: AxisItem[]) =>
        `<b>${escapeHtml(items[0]?.axisValueLabel ?? '')}</b>`
        + items.map(item => `<div>${item.marker} ${escapeHtml(item.seriesName)}: <b>${money(item.value)}</b></div>`).join(''),
    },
    xAxis: { type: 'category', data: props.labels, axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false }, axisLabel: { color: colors.muted, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: moneyCompact }, splitLine: { lineStyle: { color: colors.border } } },
    series: [
      ...props.income.map((series, index) => ({
        name: series.name, type: 'bar', stack: 'gross', data: series.data, barMaxWidth: 36,
        color: colors.series[BAR_COLOR_INDEXES[index % BAR_COLOR_INDEXES.length]! % colors.series.length],
        ...(index === props.income.length - 1 ? { itemStyle: { borderRadius: [6, 6, 0, 0] } } : {}),
      })),
      line('Neto', props.net, colors.accent),
      line('Neto tras gastos', props.netAfterExpenses, colors.series[1]!),
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
