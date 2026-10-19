import { Capacitor } from '@capacitor/core'
import { getAccessToken, revokeToken, SCOPE } from './google'

/**
 * Token de Google para Sheets/Drive.
 * - Web / PWA (escritorio y navegador): Google Identity Services.
 * - APK Android: login nativo (Credential Manager) con el plugin SocialLogin; requiere un
 *   cliente OAuth tipo Android (paquete + SHA-1) en el mismo proyecto de Google Cloud.
 * En ambos casos se usa el mismo cliente web (`googleClientId`), así las dos apps ven la misma hoja (drive.file).
 */
const native = () => Capacitor.isNativePlatform()

let nativeToken: { value: string; expiresAt: number } | null = null
let nativeInit: Promise<void> | null = null

export const authSupported = () => true

async function nativeLogin(clientId: string, interactive: boolean): Promise<string> {
  if (nativeToken && nativeToken.expiresAt > Date.now() + 60_000) return nativeToken.value
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  nativeInit ??= SocialLogin.initialize({ google: { webClientId: clientId } })
  await nativeInit
  const res = await SocialLogin.login({
    provider: 'google',
    options: {
      scopes: [SCOPE],
      // En segundo plano: reutiliza la cuenta ya autorizada sin mostrar el selector.
      filterByAuthorizedAccounts: !interactive,
      autoSelectEnabled: !interactive,
    },
  })
  const token = (res.result as { accessToken?: { token?: string } | null }).accessToken?.token
  if (!token) throw new Error('Google no entregó permiso de acceso a la hoja')
  // Credential Manager no informa la expiración; los tokens de Google duran 1 h.
  nativeToken = { value: token, expiresAt: Date.now() + 55 * 60_000 }
  return token
}

export function getToken(config: Record<string, string>, interactive: boolean): Promise<string> {
  const clientId = String(config.googleClientId)
  return native() ? nativeLogin(clientId, interactive) : getAccessToken(clientId, interactive)
}

export async function signOut() {
  if (native()) {
    nativeToken = null
    const { SocialLogin } = await import('@capgo/capacitor-social-login')
    await SocialLogin.logout({ provider: 'google' }).catch(() => {})
  } else {
    revokeToken()
  }
}
