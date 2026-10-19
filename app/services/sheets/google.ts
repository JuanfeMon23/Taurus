/** Autorización de Google en el navegador (Google Identity Services, flujo de token; sin client_secret). */
// drive.file: la app solo ve las hojas que ella misma crea.
export const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_URL = 'https://accounts.google.com/gsi/client'

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }

let gis: Promise<void> | null = null
let client: TokenClient | null = null
let pending: { resolve(t: string): void; reject(e: Error): void } | null = null
let token: { value: string; expiresAt: number } | null = null

function loadGis(): Promise<void> {
  gis ??= new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = GIS_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gis = null; reject(new Error('No se pudo cargar Google (¿sin internet?)')) }
    document.head.appendChild(s)
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
    callback: (r: TokenResponse) => {
      if (r.access_token) {
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
        pending?.resolve(r.access_token)
      } else {
        pending?.reject(new Error(r.error_description || r.error || 'Autorización rechazada'))
      }
      pending = null
    },
    error_callback: (e: { type?: string; message?: string }) => {
      pending?.reject(new Error(e.message || e.type || 'Autorización cancelada'))
      pending = null
    },
  }) as TokenClient
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    client!.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

export function revokeToken() {
  const g = (window as any).google
  if (token && g?.accounts?.oauth2) g.accounts.oauth2.revoke(token.value, () => {})
  token = null
}
