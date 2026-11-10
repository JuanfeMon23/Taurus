export interface ToastMsg {
  id: number
  text: string
  kind: 'ok' | 'error'
}

const toasts = ref<ToastMsg[]>([])
let seq = 0

/** Avisos de la app (`show(texto, tipo)`) sobre el toaster propio de app.vue. Se llama `useNotify` para no chocar con el `useToast` que Nuxt UI auto-importa. */
export function useNotify() {
  function show(text: string, kind: ToastMsg['kind'] = 'ok', ms = 2200) {
    const id = ++seq
    toasts.value.push({ id, text, kind })
    setTimeout(() => (toasts.value = toasts.value.filter(toast => toast.id !== id)), ms)
  }
  return { toasts, show }
}
