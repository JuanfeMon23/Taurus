/** Aviso mínimo de "los datos locales cambiaron" (lo consume la sincronización). */
const listeners = new Set<() => void>()

export const onDataChange = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const emitDataChange = () => listeners.forEach(fn => fn())
