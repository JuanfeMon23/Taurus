<script setup lang="ts">
import { money } from '../utils/format'

const props = defineProps<{ value: number }>()
const shown = ref(props.value)
let raf = 0

watch(() => props.value, (to) => {
  cancelAnimationFrame(raf)
  const from = shown.value
  if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shown.value = to
    return
  }
  const t0 = performance.now()
  const dur = 650
  const step = (now: number) => {
    const p = Math.min((now - t0) / dur, 1)
    shown.value = from + (to - from) * (1 - Math.pow(1 - p, 3))
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <span class="num">{{ money(shown) }}</span>
</template>
