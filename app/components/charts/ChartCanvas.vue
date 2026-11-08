<script setup lang="ts">
// Único punto donde se registran los módulos de ECharts (tree-shaking); solo cliente (la app es ssr:false).
import { use } from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { BarChart, CustomChart, LineChart } from 'echarts/charts'
import { AxisPointerComponent, GraphicComponent, GridComponent, LegendComponent, PolarComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([BarChart, LineChart, CustomChart, AxisPointerComponent, GraphicComponent, GridComponent, LegendComponent, PolarComponent, TooltipComponent, SVGRenderer])

defineProps<{ option: EChartsCoreOption }>()
</script>

<template>
  <VChart class="chart-canvas" :option="option" :update-options="{ notMerge: true }" autoresize />
</template>

<style scoped>
.chart-canvas { width: 100%; height: 100%; }
</style>
