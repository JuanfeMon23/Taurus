import { ApiError } from '../services/apiStore'

export const GENERIC_ERROR = 'Ocurrió un error inesperado; inténtalo de nuevo.'

/** Mensaje legible en español para mostrar al usuario; nunca el error crudo. */
export function toUserMessage(error: unknown): string {
  return error instanceof ApiError && error.message ? error.message : GENERIC_ERROR
}
