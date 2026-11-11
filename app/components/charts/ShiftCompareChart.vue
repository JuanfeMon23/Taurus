<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { useChartTheme } from '../../composables/useChartTheme'
import { BAR_RADIUS, categoryAxis, chartGrid, tooltipCard, valueAxis } from '../../utils/chartOptions'
import { money, moneyCompact } from '../../utils/format'
import { ALL_SHIFTS_KEY } from '../../utils/shiftStats'
import { highlightOpacity, isShiftHighlighted } from '../../utils/shiftWeekday'
import ChartCanvas from './ChartCanvas.vue'

/**
 * Barras horizontales: un valor por turno (plantilla). El color identifica al turno y es el mismo en las dos gráficas
 * comparativas (posición del turno en la paleta categórica); el nombre y el valor van siempre rotulados, así que el
 * color nunca es la única señal. Con un turno elegido en el filtro, los demás se atenúan. Los valores negativos se dibujan reales (a la izquierda del cero).
 */
const props = withDefaults(defineProps<{
  /** Turnos en el orden del desglose; `value` null = sin dato (no se dibuja). */
  items: { key: string; name: string; value: number | null }[]
  /** Texto del tooltip y del rótulo, p. ej. «Neto por hora de turno». */
  metricLabel: string
  /** Sufijo del valor mostrado, p. ej. «/h». */
  unit?: string
  /** Turno elegido en el filtro (clave); los demás se dibujan atenuados. */
  shiftKey?: string
}>(), { shiftKey: ALL_SHIFTS_KEY })

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
    grid: chartGrid(8, 72),
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'item',
      formatter: (item: { name: string; value: number; color: string }) => tooltipCard({
        title: item.name,
        rows: [{ color: item.color, label: props.metricLabel, value: `${money(item.value)}${unitSuffix.value}` }],
      }),
    },
    xAxis: valueAxis(colors),
    yAxis: { ...categoryAxis(colors, ordered.map(item => item.name), { baseline: true }), axisLabel: { color: colors.textSecondary, fontSize: 12, width: 130, overflow: 'truncate' } },
    series: [{
      type: 'bar', barMaxWidth: 22, showBackground: true,
      backgroundStyle: { color: colors.surfaceRaised, opacity: 0.45, borderRadius: BAR_RADIUS + 2 },
      data: ordered.map(item => ({ value: item.value, itemStyle: { color: colorOf(item.key), opacity: highlightOpacity(isShiftHighlighted(item.key, props.shiftKey)), borderRadius: item.value >= 0 ? [0, BAR_RADIUS + 2, BAR_RADIUS + 2, 0] : [BAR_RADIUS + 2, 0, 0, BAR_RADIUS + 2] } })),
      label: { show: true, position: 'right', color: colors.text, fontFamily: colors.font, fontSize: 12, fontWeight: 600, formatter: (item: { value: number }) => `${moneyCompact(item.value)}${unitSuffix.value}` },
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
