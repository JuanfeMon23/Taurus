<script setup lang="ts">
import type { CustomSeriesRenderItemAPI, CustomSeriesRenderItemParams } from 'echarts'
import type { EChartsCoreOption } from 'echarts/core'
import { escapeHtml, useChartTheme } from '../../composables/useChartTheme'
import { computeVisibleRange, formatClock, type ActivityRow } from '../../utils/chartSeries'
import { money } from '../../utils/format'
import { formatDuration } from '../../utils/trip'
import ChartCanvas from './ChartCanvas.vue'

/**
 * Línea de tiempo (eje limitado al rango visible de turnos y viajes): una fila por día; cada viaje es un segmento grueso
 * entre dos puntos (recogida → llegada). Los turnos se sombrean detrás y los huecos punteados (tiempo muerto) solo aparecen
 * dentro de turnos; los viajes fuera de turno tienen otro estilo.
 */
const props = defineProps<{ rows: ActivityRow[]; single: boolean }>()

const { palette, baseOption } = useChartTheme()

const ROW_HEIGHT = 40
const MAX_VISIBLE_HEIGHT = 440

const dateFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })
const dayLabel = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00`)).replace(/\./g, '')

const chartHeight = computed(() => (props.single ? 240 : Math.max(200, props.rows.length * ROW_HEIGHT + 56)))

const range = computed(() => computeVisibleRange(props.rows))
const axisInterval = computed(() => ((range.value.endMinute - range.value.startMinute) > 12 * 60 ? 180 : 60))

interface BarMeta { html: string }
interface BarDatum { value: [number, number, number]; meta: BarMeta }

function tripBars(outOfShift: boolean): BarDatum[] {
  return props.rows.flatMap((row, rowIndex) =>
    row.trips.filter(trip => row.outOfShiftTripIds.includes(trip.tripId) === outOfShift).map(trip => ({
      value: [rowIndex, trip.startMinute, trip.endMinute] as [number, number, number],
      meta: {
        html: `<b>${formatClock(trip.startMinute)} – ${formatClock(trip.endMinute)}</b><div>${escapeHtml(dayLabel(row.date))}</div>`
          + `<div>Duración: <b>${formatDuration(trip.minutes)}</b></div><div>Monto: <b>${money(trip.amount)}</b></div>`
          + (outOfShift ? '<div><b>fuera de turno</b></div>' : ''),
      },
    })))
}
const tripData = computed(() => tripBars(false))
const outOfShiftData = computed(() => tripBars(true))

const shiftData = computed<BarDatum[]>(() => props.rows.flatMap((row, rowIndex) =>
  row.shifts.map(shift => ({
    value: [rowIndex, shift.startMinute, shift.endMinute] as [number, number, number],
    meta: { html: `<b>Turno ${formatClock(shift.startMinute)} – ${formatClock(shift.endMinute)}</b><div>${escapeHtml(dayLabel(row.date))}</div><div>Duración: <b>${formatDuration(shift.minutes)}</b></div>` },
  }))))

const gapData = computed<BarDatum[]>(() => props.rows.flatMap((row, rowIndex) =>
  row.gaps.map(gap => ({
    value: [rowIndex, gap.startMinute, gap.endMinute] as [number, number, number],
    meta: {
      html: `<b>Tiempo muerto</b><div>${formatClock(gap.startMinute)} – ${formatClock(gap.endMinute)}</div><div>Duración: <b>${formatDuration(gap.minutes)}</b></div>`,
    },
  }))))

function buildRenderer(options: { color: string; width: number; dashed: boolean; ring: string | null; hollow?: boolean }) {
  return (_params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
    const row = api.value(0) as number
    const start = api.coord([api.value(1), row])
    const end = api.coord([Math.min(api.value(2) as number, range.value.endMinute), row])
    const children: Record<string, unknown>[] = [{
      type: 'line',
      shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
      style: { stroke: options.color, lineWidth: options.width, lineCap: 'round', lineDash: options.dashed ? [2, 7] : undefined, opacity: options.dashed ? 0.7 : 1 },
    }]
    if (options.ring) {
      const radius = options.width / 2 + 1.5
      children.push(
        { type: 'circle', shape: { cx: start[0], cy: start[1], r: radius }, style: { fill: options.ring, stroke: options.color, lineWidth: 3 } },
        { type: 'circle', shape: { cx: end[0], cy: end[1], r: radius }, style: { fill: options.hollow ? options.ring : options.color, stroke: options.hollow ? options.color : options.ring, lineWidth: 2 } },
      )
    }
    return { type: 'group', children } as never
  }
}

/** Banda sombreada del turno: ocupa casi todo el alto de la fila, detrás de viajes y huecos. */
function renderShiftBand(color: string) {
  return (_params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
    const row = api.value(0) as number
    const start = api.coord([api.value(1), row])
    const end = api.coord([Math.min(api.value(2) as number, range.value.endMinute), row])
    const height = (api.size!([0, 1]) as number[])[1]! * 0.8
    return { type: 'rect', shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height, r: 6 }, style: { fill: color, opacity: 0.16 } } as never
  }
}

const option = computed<EChartsCoreOption>(() => {
  const colors = palette.value
  const tripWidth = props.single ? 12 : 8
  return {
    ...baseOption.value,
    grid: { left: 8, right: 20, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...baseOption.value.tooltip,
      trigger: 'item',
      formatter: (item: { data: BarDatum }) => item.data.meta.html,
    },
    xAxis: {
      type: 'value', min: range.value.startMinute, max: range.value.endMinute, interval: axisInterval.value, position: 'top',
      axisLabel: { color: colors.muted, formatter: (minute: number) => `${Math.round(minute / 60) % 24} h` },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: colors.border } },
    },
    yAxis: {
      type: 'category', inverse: true, data: props.rows.map(row => dayLabel(row.date)),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: colors.textSecondary, fontSize: props.single ? 13 : 12 },
      splitLine: { show: true, lineStyle: { color: colors.border, type: 'dashed', opacity: 0.5 } },
    },
    series: [
      { name: 'Turnos', type: 'custom', z: 0, data: shiftData.value, renderItem: renderShiftBand(colors.info) },
      { name: 'Tiempo muerto', type: 'custom', z: 1, data: gapData.value, renderItem: buildRenderer({ color: colors.muted, width: 3, dashed: true, ring: null }) },
      { name: 'Fuera de turno', type: 'custom', z: 2, data: outOfShiftData.value, renderItem: buildRenderer({ color: colors.negative, width: tripWidth, dashed: false, ring: colors.surface, hollow: true }) },
      { name: 'Viajes', type: 'custom', z: 3, data: tripData.value, renderItem: buildRenderer({ color: colors.accent, width: tripWidth, dashed: false, ring: colors.surface }) },
    ],
  }
})
</script>

<template>
  <div class="timeline">
    <div v-if="rows.length" class="scroller" :style="{ maxHeight: `${MAX_VISIBLE_HEIGHT}px` }">
      <div :style="{ height: `${chartHeight}px` }"><ChartCanvas :option="option" /></div>
    </div>
    <p v-else class="timeline-empty muted small">Aún no hay viajes con hora de recogida y llegada para dibujar la línea de tiempo.</p>
    <div v-if="rows.length" class="legend small muted">
      <span><i class="dot trip" /> Viaje (recogida → llegada)</span>
      <span><i class="dot gap" /> Tiempo muerto (dentro de turno)</span>
      <span v-if="rows.some(row => row.hasShifts)"><i class="dot shift" /> Turno</span>
      <span v-if="rows.some(row => row.outOfShiftTripIds.length)"><i class="dot off" /> Viaje fuera de turno</span>
    </div>
  </div>
</template>

<style scoped>
.timeline { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.scroller { overflow-y: auto; overflow-x: hidden; border-radius: var(--radius-sm); }
.timeline-empty { display: grid; place-items: center; min-height: 140px; text-align: center; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; }
.dot { display: inline-block; vertical-align: middle; margin-right: 6px; }
.dot.trip { width: 22px; height: 8px; border-radius: 4px; background: var(--accent); }
.dot.shift { width: 22px; height: 12px; border-radius: 4px; background: var(--info); opacity: 0.25; }
.dot.off { width: 22px; height: 8px; border-radius: 4px; border: 2px solid var(--neg); }
.dot.gap { width: 22px; height: 0; border-top: 3px dotted var(--muted); }
</style>
