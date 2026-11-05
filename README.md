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

## Backend (API local)

Requisitos: Python 3.13, [uv](https://docs.astral.sh/uv/) y PostgreSQL con la base `taurus`.

```bash
cd backend
cp .env.example .env        # ajusta DATABASE_URL
uv sync
uv run alembic upgrade head
uv run python -m app        # http://127.0.0.1:8400/api/v1/health
```

Escucha solo en `127.0.0.1:8400`. Tests: `uv run pytest -q` (usa la base `taurus_test`).

## Google Sheets (opcional)

La sincronización usa un ID de cliente OAuth web; se puede cambiar con la variable `NUXT_PUBLIC_GOOGLE_CLIENT_ID`.
En Google Cloud: activar Google Sheets API y Google Drive API, autorizar el origen `http://localhost:4321` en el cliente web y crear un cliente Android con el paquete `com.taurus.app` y la SHA-1 de la firma del APK.
