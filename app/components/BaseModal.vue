<script setup lang="ts">
import { X } from 'lucide-vue-next'

const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const titleId = `modal-${useId()}`
let opener: HTMLElement | null = null

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusables = () => Array.from(panel.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    opener = document.activeElement as HTMLElement | null
    await nextTick()
    // Foco al primer campo del formulario; si no hay, al primer control (cerrar).
    const first = panel.value?.querySelector<HTMLElement>('input, select, textarea') ?? focusables()[0]
    first?.focus()
  } else {
    opener?.focus()
    opener = null
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-overlay" @click.self="emit('close')" @keydown="onKeydown">
        <div ref="panel" class="modal-panel card stack" role="dialog" aria-modal="true" :aria-labelledby="titleId">
          <div class="row between">
            <h2 :id="titleId">{{ title }}</h2>
            <button type="button" class="btn icon ghost" aria-label="Cerrar" @click="emit('close')"><X :size="20" /></button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
}
.modal-panel { width: min(440px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; }
.modal-panel h2 { font-size: 18px; font-weight: 800; }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .modal-enter-active, .modal-leave-active { transition: none; } }
</style>
