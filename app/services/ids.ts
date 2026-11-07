/** Id único global (UUID v4). */
export function newId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  // Respaldo para contextos sin randomUUID (p. ej. http no seguro).
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const now = () => new Date().toISOString()

/** Fecha mínima: lo sembrado por defecto pierde contra cualquier edición real. */
export const EPOCH = '1970-01-01T00:00:00.000Z'
