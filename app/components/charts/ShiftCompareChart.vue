<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { escapeHtml, useChartTheme } from '../../composables/useChartTheme'
import { money, moneyCompact } from '../../utils/format'
import ChartCanvas from './ChartCanvas.vue'

/**
 * Barras horizontales: un valor por turno (plantilla). El color identifica al turno y es el mismo en las dos gráficas
 * comparativas (posición del turno en la paleta categórica); el nombre y el valor van siempre rotulados, así que el
 * color nunca es la única señal. Los valores negativos se dibujan reales (a la izquierda del cero).
 */
const props = defineProps<{
  /** Turnos en el orden del desglose; `value` null = sin dato (no se dibuja). */
  items: { key: string; name: string; value: number | null }[]
  /** Texto del tooltip y del rótulo, p. ej. «Neto por hora de turno». */
  metricLabel: string
  /** Sufijo del valor mostrado, p. ej. «/h». */
  unit?: string
}>()

const { palette, baseOption } = useChartTheme()

const drawn = computed(() => props.items.filter((item): item is { key: string; name: string; value: number } => item.value !== null))
const height = computed(() => `${Math.max(150, 64 + drawn.value.length * 44)}px`)
const unitSuffix = computed(() => props.unit ?? '')

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  // Mismo color por turno en ambas gráficas: se toma la posición en la lista completa, no entre los dibujados.
  const colorOf = (key: string) => colors.series[props.items.findIndex(item => item.key === key) % colors.series.length]
  const ordered = [...drawn.value].reverse() // el eje de categorías horizontal crece hacia arriba
  return {
    ...baseOption.value,
    grid: { left: 8, right: 72, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'item',
      formatter: (item: { name: string; value: number }) => `<b>${escapeHtml(item.name)}</b><div>${escapeHtml(props.metricLabel)}: <b>${money(item.value)}${unitSuffix.value}</b></div>`,
    },
    xAxis: { type: 'value', axisLabel: { color: colors.muted, formatter: moneyCompact }, splitLine: { lineStyle: { color: colors.border } } },
    yAxis: {
      type: 'category', data: ordered.map(item => item.name), axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false },
      axisLabel: { color: colors.textSecondary, width: 130, overflow: 'truncate' },
    },
    series: [{
      type: 'bar', barMaxWidth: 28,
      data: ordered.map(item => ({ value: item.value, itemStyle: { color: colorOf(item.key), borderRadius: item.value >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6] } })),
      label: { show: true, position: 'right', color: colors.text, fontFamily: colors.font, fontSize: 12, formatter: (item: { value: number }) => `${moneyCompact(item.value)}${unitSuffix.value}` },
    }],
  }
})
</script>

<template>
  <div class="chart-wrap" :style="{ height }">
    <ChartCanvas v-if="drawn.length" :option="option" />
    <p v-else class="chart-empty muted small">Sin turnos para comparar en este periodo.</p>
  </div>
</template>

<style scoped>
.chart-empty { display: grid; place-items: center; height: 100%; text-align: center; }
</style>
