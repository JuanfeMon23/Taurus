/** Mensaje legible para el 422 `unknown_catalog_code` del backend (un código de catálogo que la base no conoce). */

const FIELD_LABELS: Record<string, string> = {
  'categories.rateMode': 'el modo de tarifa',
  'services.method': 'el medio de pago',
  'movements.accountId': 'la cuenta del movimiento',
  'movements.toAccountId': 'la cuenta de destino',
  'paymentMethods.accountId': 'la cuenta del medio de pago',
  'movements.type': 'el tipo de movimiento',
  'movements.categoryId': 'la categoría de gasto',
  'fundMovements.type': 'el tipo de movimiento de fondo',
  'fundMovements.categoryId': 'la categoría del fondo',
}

interface UnknownCodeDetail {
  campo?: unknown
  mensaje?: unknown
}

/** Código que viene tras los dos puntos del mensaje del backend («Código de catálogo desconocido: nope»). */
const codeOf = (message: unknown): string => (typeof message === 'string' ? message.split(':').slice(1).join(':').trim() : '')

/** Aviso del 422 por viajes vivos sin turno (`services.shiftId`), sea cual sea el `code`; vacío si los detalles no hablan de eso. */
export const missingShiftMessage = (details: unknown): string =>
  Array.isArray(details) && details.some(detail => typeof detail?.campo === 'string' && detail.campo === 'services.shiftId')
    ? 'Hay viajes de este día sin turno; asígnales uno'
    : ''

const ACCOUNT_RULE_PHRASES: Record<string, string> = {
  'paymentMethods.affectsCash': 'Un medio de pago afecta la caja solo si su cuenta es la caja; cambia la cuenta del medio en Tarifas > Catálogos.',
  'movements.toAccountId': 'Un traslado necesita una cuenta de destino distinta de la de origen; los demás movimientos no llevan destino.',
}

/** Frases del 422 `account_rule_violation` (una por regla incumplida, sin repetir); sin detalles reconocibles, una frase general. */
export function accountRuleViolationMessage(details: unknown): string {
  const phrases = (Array.isArray(details) ? (details as UnknownCodeDetail[]) : []).map(detail => (typeof detail?.campo === 'string' ? ACCOUNT_RULE_PHRASES[detail.campo] : undefined)).filter(Boolean)
  const unique = [...new Set(phrases)]
  return unique.length ? unique.join(' ') : 'Los datos no cumplen las reglas de las cuentas; revisa las cuentas y el destino de los traslados.'
}

/** Una frase por detalle, sin repetir; sin detalles útiles devuelve una frase general. */
export function unknownCatalogCodeMessage(details: unknown): string {
  const phrases = (Array.isArray(details) ? (details as UnknownCodeDetail[]) : []).map(detail => {
    if (typeof detail?.campo === 'string' && /(^|\.)shiftId$/.test(detail.campo)) return 'El turno de un viaje ya no existe en el servidor; vuelve a elegir el turno del viaje y guarda de nuevo.'
    const label = typeof detail?.campo === 'string' ? FIELD_LABELS[detail.campo] : undefined
    const code = codeOf(detail?.mensaje)
    if (label && code) return `La opción «${code}» de ${label} no existe en el servidor; agrégala o actívala en Tarifas > Catálogos.`
    if (code) return `La opción «${code}» no existe en el servidor; agrégala o actívala en Tarifas > Catálogos.`
    return ''
  }).filter(Boolean)
  const unique = [...new Set(phrases)]
  return unique.length ? unique.join(' ') : 'Una opción de catálogo usada no existe en el servidor; revisa Tarifas > Catálogos.'
}
