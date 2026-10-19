# Taurus

## Requisitos

- Node.js 24 y [pnpm](https://pnpm.io)
- Para el APK Android: JDK 21 y Android SDK (`ANDROID_HOME`), con `platforms;android-35` y `build-tools;35.0.0`

## Instalar

```bash
pnpm install
```

## Ejecutar

| Qué | Comando |
|---|---|
| Desarrollo (navegador) | `pnpm dev` |
| Web/PWA local en `http://localhost:4321` (compila y sirve) | `pnpm local` |
| Servir lo ya compilado | `pnpm serve:local` |
| Tests | `pnpm test` |
| Tipos | `pnpm typecheck` |

### APK Android (debug)

```bash
pnpm build:native
cd android
./gradlew assembleDebug   # Windows: gradlew.bat assembleDebug
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Google Sheets (opcional)

La sincronización usa un ID de cliente OAuth web; se puede cambiar con la variable `NUXT_PUBLIC_GOOGLE_CLIENT_ID`.
En Google Cloud: activar Google Sheets API y Google Drive API, autorizar el origen `http://localhost:4321` en el cliente web y crear un cliente Android con el paquete `com.taurus.app` y la SHA-1 de la firma del APK.
