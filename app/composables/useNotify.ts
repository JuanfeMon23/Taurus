import { useToast as useUiToast } from '@nuxt/ui/composables/useToast'

export type ToastKind = 'ok' | 'error'

/** Avisos de la app (`show(texto, tipo)`) sobre el sistema de toasts de Nuxt UI. */
export function useNotify() {
  const toast = useUiToast()
  function show(text: string, kind: ToastKind = 'ok', ms = 2200) {
    toast.add({
      title: text,
      color: kind === 'ok' ? 'success' : 'error',
      icon: kind === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert',
      duration: kind === 'ok' ? ms : Math.max(ms, 4000),
    })
  }
  return { show }
}
