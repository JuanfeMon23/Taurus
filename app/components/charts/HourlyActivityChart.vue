<script setup lang="ts">
import type { EChartsCoreOption } from 'echarts/core'
import { useChartTheme } from '../../composables/useChartTheme'
import { tooltipCard } from '../../utils/chartOptions'
import { formatDuration } from '../../utils/trip'
import ChartCanvas from './ChartCanvas.vue'

/**
 * Barras radiales de 24 h. Con turnos: solo las horas con turno, y la altura es activo/turno de esa hora (0–100 %).
 * Sin turnos en el periodo: minutos activos por hora del reloj. La mejor franja va resaltada.
 */
const props = defineProps<{ hourlyMinutes: number[]; hourlyShiftMinutes: number[]; bestHour: number | null }>()

const { palette, baseOption } = useChartTheme()

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const hasActivity = computed(() => props.bestHour !== null)
const hasShiftData = computed(() => props.hourlyShiftMinutes.some(minutes => minutes > 0))
/** Valor dibujado por hora: proporción activo/turno (null = hora sin turno, no se dibuja) o minutos activos sin turnos. */
const hourValues = computed<(number | null)[]>(() => props.hourlyMinutes.map((minutes, hour) => {
  if (!hasShiftData.value) return minutes
  const shiftMinutes = props.hourlyShiftMinutes[hour] ?? 0
  return shiftMinutes > 0 ? Math.min(1, minutes / shiftMinutes) : null
}))

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const peak = hasShiftData.value ? 1 : Math.max(...props.hourlyMinutes, 1)
  return {
    ...baseOption.value,
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'item',
      formatter: (item: { dataIndex: number; value: number | null; color: string }) => {
        const title = `${hourLabel(item.dataIndex)} – ${hourLabel((item.dataIndex + 1) % 24)}`
        if (!hasShiftData.value) return tooltipCard({ title, rows: [{ color: item.color, label: 'Activos', value: formatDuration(Math.round(item.value ?? 0)) || '0 min' }] })
        const active = Math.round(props.hourlyMinutes[item.dataIndex] ?? 0)
        const shift = Math.round(props.hourlyShiftMinutes[item.dataIndex] ?? 0)
        return tooltipCard({
          title,
          rows: [
            { color: item.color, label: 'Activos', value: formatDuration(active) || '0 min' },
            { label: 'De turno', value: formatDuration(shift) },
          ],
          footer: { label: 'Aprovechamiento', value: `${Math.round((item.value ?? 0) * 100)} %` },
        })
      },
    },
    polar: { radius: ['36%', '88%'], center: ['50%', '50%'] },
    angleAxis: {
      type: 'category', data: props.hourlyMinutes.map((_minutes, hour) => hour), startAngle: 90, clockwise: true,
      axisLabel: { color: colors.muted, fontSize: 11, interval: 2, formatter: (hour: string) => `${hour} h` },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: colors.border, type: [4, 4] } },
    },
    radiusAxis: { type: 'value', show: false, max: peak },
    series: [{
      type: 'bar', coordinateSystem: 'polar', roundCap: true, barCategoryGap: '18%',
      data: hourValues.value.map((value, hour) => ({
        value,
        itemStyle: { color: hour === props.bestHour ? colors.accent : colors.series[0], opacity: hour === props.bestHour ? 1 : 0.35 + 0.65 * ((value ?? 0) / peak) },
      })),
      backgroundStyle: { color: colors.surfaceRaised, opacity: 0.6 }, showBackground: true,
    }],
    graphic: props.bestHour === null ? undefined : [{
      type: 'text', left: 'center', top: 'middle', silent: true,
      style: { text: `${hourLabel(props.bestHour)}\nmejor franja`, textAlign: 'center', fill: colors.text, fontSize: 11, fontWeight: 600, fontFamily: colors.font, lineHeight: 15 },
    }],
  }
})
</script>

<template>
  <div class="hourly">
    <ChartCanvas v-if="hasActivity" :option="option" />
    <p v-else class="hourly-empty muted small">Sin horarios registrados en este periodo.</p>
  </div>
</template>

<style scoped>
.hourly { height: 280px; }
.hourly-empty { display: grid; place-items: center; height: 100%; text-align: center; }
</style>
