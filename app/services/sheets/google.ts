/** Autorización de Google en el navegador (Google Identity Services, flujo de token; sin client_secret). */
// drive.file: la app solo ve las hojas que ella misma crea.
export const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_URL = 'https://accounts.google.com/gsi/client'

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(options?: { prompt?: string }): void }

let gis: Promise<void> | null = null
let client: TokenClient | null = null
let pending: { resolve(accessToken: string): void; reject(error: Error): void } | null = null
let token: { value: string; expiresAt: number } | null = null

function loadGis(): Promise<void> {
  gis ??= new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve()
    const script = document.createElement('script')
    script.src = GIS_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { gis = null; reject(new Error('No se pudo cargar Google (¿sin internet?)')) }
    document.head.appendChild(script)
  })
  return gis
}

/** Devuelve un token válido; `interactive` permite abrir la ventana de consentimiento (requiere gesto del usuario). */
export async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value
  await loadGis()
  client ??= (window as any).google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response: TokenResponse) => {
      if (response.access_token) {
        token = { value: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 }
        pending?.resolve(response.access_token)
      } else {
        pending?.reject(new Error(response.error_description || response.error || 'Autorización rechazada'))
      }
      pending = null
    },
    error_callback: (error: { type?: string; message?: string }) => {
      pending?.reject(new Error(error.message || error.type || 'Autorización cancelada'))
      pending = null
    },
  }) as TokenClient
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    client!.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

export function revokeToken() {
  const googleApi = (window as any).google
  if (token && googleApi?.accounts?.oauth2) googleApi.accounts.oauth2.revoke(token.value, () => {})
  token = null
}
