<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { useChartTheme } from '../../composables/useChartTheme'
import { heatCell, hiddenHeatVisualMap, tooltipCard } from '../../utils/chartOptions'
import { money, moneyCompact } from '../../utils/format'
import { ALL_WEEKDAYS_KEY, cellOpacity, WEEKDAY_NAMES, WEEKDAY_SHORT_NAMES, type ShiftWeekdayRow } from '../../utils/shiftWeekday'
import { ALL_SHIFTS_KEY } from '../../utils/shiftStats'
import { formatDuration } from '../../utils/trip'
import ChartCanvas from './ChartCanvas.vue'

/**
 * Mapa de calor turno × día de la semana: valor = neto por hora de turno. Escala secuencial de un tono (azul de
 * información; los netos negativos usan el color negativo); el valor va rotulado en cada celda, así que el color no es
 * la única señal. Las celdas sin datos se dejan vacías, no en 0. Con filtro de turno y/o día se muestran todas, pero las que
 * no coinciden se atenúan (resaltado, no recorte).
 */
const props = withDefaults(defineProps<{ rows: ShiftWeekdayRow[]; shiftKey?: string; weekdayKey?: string }>(), { shiftKey: ALL_SHIFTS_KEY, weekdayKey: ALL_WEEKDAYS_KEY })

const { palette, baseOption } = useChartTheme()
const height = computed(() => `${Math.max(150, 76 + props.rows.length * 46)}px`)
const hasValues = computed(() => props.rows.some(row => row.cells.some(cell => cell?.netPerShiftHour != null)))

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const values = props.rows.flatMap(row => row.cells.map(cell => cell?.netPerShiftHour)).filter((value): value is number => value != null)
  const maxMagnitude = Math.max(1, ...values.map(Math.abs))
  const data = props.rows.flatMap((row, rowIndex) => row.cells.flatMap((cell, columnIndex) => {
    if (!cell || cell.netPerShiftHour === null) return []
    const { fill, label } = heatCell(cell.netPerShiftHour < 0 ? colors.negative : colors.info, colors.surface, Math.abs(cell.netPerShiftHour) / maxMagnitude)
    return [{ value: [columnIndex, rowIndex, cell.netPerShiftHour], itemStyle: { color: fill, opacity: cellOpacity(row.key, columnIndex, props.shiftKey, props.weekdayKey) }, label: { color: label || colors.text } }]
  }))
  return {
    ...baseOption.value,
    grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
    visualMap: hiddenHeatVisualMap(maxMagnitude),
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'item',
      formatter: (item: { value: [number, number, number] }) => {
        const [columnIndex, rowIndex] = item.value
        const row = props.rows[rowIndex]
        const cell = row?.cells[columnIndex]
        if (!row || !cell) return ''
        return tooltipCard({
          title: row.name,
          subtitle: WEEKDAY_NAMES[columnIndex],
          rows: [
            { label: 'Neto por hora de turno', value: `${money(item.value[2])}/h` },
            { label: 'Neto', value: money(cell.net) },
            { label: 'Viajes', value: String(cell.trips) },
            { label: 'Horas de turno', value: formatDuration(Math.round(cell.shiftMinutes)) || '0 min' },
          ],
        })
      },
    },
    xAxis: {
      type: 'category', data: [...WEEKDAY_SHORT_NAMES], position: 'top', splitArea: { show: true, areaStyle: { color: [colors.surfaceRaised, colors.surface], opacity: 0.35 } },
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: colors.textSecondary, fontSize: 12 },
    },
    yAxis: {
      type: 'category', data: props.rows.map(row => row.name), inverse: true, splitArea: { show: true, areaStyle: { color: [colors.surfaceRaised, colors.surface], opacity: 0.35 } },
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: colors.textSecondary, fontSize: 12, width: 130, overflow: 'truncate' },
    },
    series: [{
      type: 'heatmap', data,
      itemStyle: { borderColor: colors.surface, borderWidth: 3, borderRadius: 6 },
      label: { show: true, fontFamily: colors.font, fontSize: 12, fontWeight: 600, formatter: (item: { value: [number, number, number] }) => moneyCompact(item.value[2]) },
      emphasis: { itemStyle: { borderColor: colors.text, borderWidth: 2 } },
    }],
  }
})
</script>

<template>
  <div class="chart-wrap" :style="{ height }">
    <ChartCanvas v-if="hasValues" :option="option" />
    <p v-else class="chart-empty muted small">Sin turnos con horas para comparar por día de la semana en este periodo.</p>
  </div>
</template>

<style scoped>
.chart-empty { display: grid; place-items: center; height: 100%; text-align: center; }
</style>
