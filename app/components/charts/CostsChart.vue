<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { escapeHtml, useChartTheme } from '../../composables/useChartTheme'
import type { CostSeries } from '../../utils/chartSeries'
import { money, moneyCompact } from '../../utils/format'
import ChartCanvas from './ChartCanvas.vue'

/** Barras apiladas por periodo: una serie por categoría de costo, más comisión y gastos varios. */
const props = defineProps<{ costs: CostSeries }>()

const { palette, baseOption } = useChartTheme()

interface AxisItem { axisValueLabel: string; marker: string; seriesName: string; value: number }

const hasAmounts = computed(() => props.costs.series.some(entry => entry.data.some(amount => amount > 0)))

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const lastIndex = props.costs.series.length - 1
  return {
    ...baseOption.value,
    color: colors.series,
    grid: { left: 8, right: 12, top: 56, bottom: 4, containLabel: true },
    legend: { top: 0, type: 'scroll', icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: colors.textSecondary } },
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: colors.accent, opacity: 0.08 } },
      formatter: (items: AxisItem[]) => {
        const visible = items.filter(item => item.value > 0)
        const total = visible.reduce((sum, item) => sum + item.value, 0)
        return `<b>${escapeHtml(items[0]?.axisValueLabel ?? '')}</b>`
          + visible.map(item => `<div>${item.marker} ${escapeHtml(item.seriesName)}: <b>${money(item.value)}</b></div>`).join('')
          + `<div style="margin-top:4px">Total: <b>${money(total)}</b></div>`
      },
    },
    xAxis: { type: 'category', data: props.costs.labels, axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false }, axisLabel: { color: colors.muted, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: moneyCompact }, splitLine: { lineStyle: { color: colors.border } } },
    series: props.costs.series.map((entry, index) => ({
      name: entry.name, type: 'bar', stack: 'costs', data: entry.data, barMaxWidth: 36,
      itemStyle: index === lastIndex ? { borderRadius: [6, 6, 0, 0] } : undefined,
    })),
  }
})
</script>

<template>
  <div class="chart-wrap">
    <ChartCanvas v-if="hasAmounts" :option="option" />
    <p v-else class="chart-empty muted small">Sin costos, comisión ni gastos en este periodo.</p>
  </div>
</template>

<style scoped>
.chart-wrap { height: 300px; }
.chart-empty { display: grid; place-items: center; height: 100%; text-align: center; }
</style>
