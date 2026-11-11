<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { useChartTheme } from '../../composables/useChartTheme'
import { BAR_RADIUS, categoryAxis, chartGrid, legendTop, tooltipCard, valueAxis } from '../../utils/chartOptions'
import type { CostSeries } from '../../utils/chartSeries'
import { money } from '../../utils/format'
import ChartCanvas from './ChartCanvas.vue'

/** Barras apiladas por periodo: una serie por categoría de costo, más comisión y gastos varios. */
const props = defineProps<{ costs: CostSeries }>()

const { palette, baseOption, axisPointer } = useChartTheme()

interface AxisItem { axisValueLabel: string; color: string; seriesName: string; value: number }

const hasAmounts = computed(() => props.costs.series.some(entry => entry.data.some(amount => amount > 0)))

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const lastIndex = props.costs.series.length - 1
  return {
    ...baseOption.value,
    color: colors.series,
    grid: chartGrid(56),
    legend: legendTop(colors),
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'axis',
      axisPointer: axisPointer.value,
      formatter: (items: AxisItem[]) => {
        const visible = items.filter(item => item.value > 0)
        return tooltipCard({
          title: items[0]?.axisValueLabel ?? '',
          rows: visible.map(item => ({ color: item.color, label: item.seriesName, value: money(item.value) })),
          footer: { label: 'Total', value: money(visible.reduce((sum, item) => sum + item.value, 0)) },
        })
      },
    },
    xAxis: categoryAxis(colors, props.costs.labels),
    yAxis: valueAxis(colors),
    series: props.costs.series.map((entry, index) => ({
      name: entry.name, type: 'bar', stack: 'costs', data: entry.data, barMaxWidth: 36,
      itemStyle: { borderColor: colors.surface, borderWidth: 1, ...(index === lastIndex ? { borderRadius: [BAR_RADIUS, BAR_RADIUS, 0, 0] } : {}) },
      emphasis: { focus: 'series' },
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
