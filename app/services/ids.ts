/** Id único global (UUID v4). */
export function newId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  // Respaldo para contextos sin randomUUID (p. ej. http no seguro).
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const now = () => new Date().toISOString()

/** Fecha mínima: lo sembrado por defecto pierde contra cualquier edición real. */
export const EPOCH = '1970-01-01T00:00:00.000Z'
