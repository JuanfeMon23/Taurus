# Taurus

## Requisitos

- Node.js 24 y [pnpm](https://pnpm.io)

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

## Deprecated

Google Sheets, la capa Android (APK con Capacitor) y la idea de inDrive están en `deprecated/` (ver `deprecated/README.md`).
