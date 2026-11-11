import { accountRuleViolationMessage, missingShiftMessage, unknownCatalogCodeMessage } from '../utils/catalogErrors'
import { emptySnapshot, type Snapshot, type Store } from './types'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export const NETWORK_ERROR = 'No se pudo conectar con el servidor local de Taurus; ¿está corriendo?'

/** Error con mensaje ya legible para el usuario. */
export class ApiError extends Error {}

/** Convierte la respuesta de error del backend (422 con `details`, u otra) en un mensaje legible. */
async function readableError(response: Response): Promise<string> {
  let body: any = null
  try {
    body = await response.json()
  } catch { /* cuerpo no JSON */ }
  if (response.status === 422) {
    if (body?.code === 'unknown_catalog_code') return unknownCatalogCodeMessage(body.details)
    if (body?.code === 'account_rule_violation') return accountRuleViolationMessage(body.details)
    const missingShift = missingShiftMessage(body?.details)
    if (missingShift) return missingShift
    const messages = Array.isArray(body?.details) ? body.details.map((detail: any) => detail?.mensaje).filter(Boolean) : []
    if (messages.length) return messages.join('. ')
    if (typeof body?.message === 'string') return body.message
    return 'Los datos enviados no son válidos.'
  }
  if (response.status >= 500) return 'El servidor local de Taurus tuvo un problema; inténtalo de nuevo.'
  if (typeof body?.message === 'string') return body.message
  return `No se pudo completar la operación (error ${response.status}).`
}

/** Store que guarda en el backend local de Taurus vía GET/PUT /snapshot. */
export function createApiStore(base: string, fetchFn: Fetch = (input, init) => fetch(input, init)): Store {
  const url = `${base.replace(/\/+$/, '')}/snapshot`

  async function call(init?: RequestInit): Promise<any> {
    let response: Response
    try {
      response = await fetchFn(url, init)
    } catch {
      throw new ApiError(NETWORK_ERROR)
    }
    if (!response.ok) throw new ApiError(await readableError(response))
    return response.json()
  }

  return {
    async load() {
      const data = await call()
      // `depositMovements` ya no existe: las salidas del depósito son movimientos de la cuenta depósito.
      const { depositMovements: _depositMovements, ...rest } = data ?? {}
      return { ...emptySnapshot(), ...rest } as Snapshot
    },
    async save(changes) {
      await call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
    },
  }
}
