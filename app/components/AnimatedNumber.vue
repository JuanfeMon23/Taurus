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
  const startTime = performance.now()
  const dur = 650
  const step = (now: number) => {
    const progress = Math.min((now - startTime) / dur, 1)
    shown.value = from + (to - from) * (1 - Math.pow(1 - progress, 3))
    if (progress < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <span class="num">{{ money(shown) }}</span>
</template>
