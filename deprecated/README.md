# deprecated/

Código fuera de la app vigente (decisión del usuario, 2026-11-10): la app quedó 100 % funcional para PC/web con el backend local. Google Sheets, la capa Android (APK con Capacitor) y la idea de integrar inDrive quedan deprecated. Se conserva por si se retoma. Está excluido de build, typecheck (vue-tsc/nuxt solo ven `app/`), lint y vitest (`vitest.config.ts` lo excluye). Los archivos conservan su historial con `git mv`.

## Contenido

| Ruta | Qué hacía |
|---|---|
| `android/android/` | Proyecto Gradle/Capacitor del APK (`com.taurus.app`). |
| `android/capacitor.config.json` | Config de Capacitor (`webDir: .output/public`, plugin SocialLogin con Google). |
| `android/app/services/sqliteStore.ts` | Almacén `Store` sobre SQLite (`@capacitor-community/sqlite`) con migraciones; el APK no usaba backend. |
| `sheets/app/services/sheets/` | `auth.ts` y `google.ts` (login OAuth web/nativo), `sheetsApi.ts` (Sheets + Drive, scope `drive.file`), `mapping.ts` (snapshot <-> filas), `sync.ts` (búsqueda/creación de la hoja `SHEET_NAME`, fusión). |
| `sheets/app/composables/useSheetsSync.ts` | Estado de sincronización, reacciona a `onDataChange`. |
| `sheets/app/components/SyncSheet.vue` | Hoja modal para conectar/sincronizar con Google. |
| `sheets/tests/sheetsMapping.test.ts`, `sheets/tests/sync.test.ts` | Tests movidos con su código (Google falso en memoria). |
| `shifts-card/app/components/ShiftsCard.vue` | Tarjeta «Turnos del día» de Hoy (2026-11-10): reemplazada por los chips de turnos en la tarjeta de Fecha de `DayForm.vue`. Perdió agregar turno suelto, editar horas del turno y copiar turnos de ayer; las plantillas se siguen editando en `ShiftTemplatesEditor.vue`. |

inDrive: nunca se implementó código; solo la idea (la comisión inDrive vigente en caja es otra cosa y sigue en la app).

Para retomar `ShiftsCard`: `git mv deprecated/shifts-card/app/components/ShiftsCard.vue app/components/` y volver a montar `<ShiftsCard :date="date" @change="shifts = $event" />` en `DayForm.vue`.

## Dependencias quitadas de package.json

| Paquete | Versión |
|---|---|
| `@capacitor/core` | ^8.5.3 |
| `@capacitor/android` (dev) | ^8.5.3 |
| `@capacitor/cli` (dev) | ^8.5.3 |
| `@capacitor-community/sqlite` | ^8.1.1 |
| `@capgo/capacitor-social-login` | 8.5.18 |
| `cross-env` (dev, solo para `build:native`) | ^10.1.0 |

Script quitado: `"build:native": "cross-env TAURUS_TARGET=native nuxt generate && cap sync android"`. Sheets usaba `fetch` directo a las APIs de Google (sin SDK).

## Puntos de conexión que se quitaron de la app vigente

- `app/app.vue`: `Capacitor.isNativePlatform()` (`native`); ocultar la pestaña `fondos` en nativo; cabecera con logo y fecha en nativo; barra inferior `.tabbar` con `.pill`; `useSheetsSync()` solo si nativo; botón nube (`Cloud`/`CloudOff` + `.dot`, clase `.sync`) que abría `<SyncSheet>`; estilos `.logo`, `.sync*`, `.tabbar*`.
- `app/composables/useTaurus.ts`: rama `if (Capacitor.isNativePlatform())` que importaba dinámicamente `createSqliteStore()` en lugar de `createApiStore`.
- `nuxt.config.ts`: `const native = process.env.TAURUS_TARGET === 'native'` y `pwa.disable: native` (sin service worker en el APK); `runtimeConfig.public.googleClientId` (`NUXT_PUBLIC_GOOGLE_CLIENT_ID`, client ID web de OAuth, proyecto Google Cloud `taurus-511717`).
- `package.json`: script `build:native` y las dependencias de arriba.
- `README.md`: secciones APK Android y Google Sheets.
- Se conservan en la app (siguen usándose): `app/utils/bus.ts` (`emitDataChange` lo llama `useTaurus`; `onDataChange` solo lo consumía Sheets), `app/services/merge.ts` (`same`, usado por `taurus.ts`), `memoryStore.ts`, `legacy*.ts` y `catalogSeeds.ts` (usados por tests y la importación única al backend).

## Cómo retomarlo

1. Android: `git mv deprecated/android/android android`, `deprecated/android/capacitor.config.json` a la raíz y `deprecated/android/app/services/sqliteStore.ts` a `app/services/`. `pnpm add @capacitor/core @capacitor-community/sqlite @capgo/capacitor-social-login` y `pnpm add -D @capacitor/android @capacitor/cli cross-env` (versiones de la tabla o superiores). Restaurar el script `build:native`.
2. Reponer en `useTaurus.ts` la rama nativa con `sqliteStore`, y en `nuxt.config.ts` el flag `native` y `pwa.disable`. Rehacer en `app.vue` la navegación móvil (tabbar) si se quiere APK.
3. Sheets: mover `deprecated/sheets/app/*` a `app/` (`services/sheets`, `composables/useSheetsSync.ts`, `components/SyncSheet.vue`) y `deprecated/sheets/tests/*` a `tests/`; reponer `googleClientId` en `runtimeConfig.public` y el botón de sincronización en `app.vue` (`useSheetsSync()` + `<SyncSheet>`). Reconectar `onDataChange` de `utils/bus.ts` (ya existe).
4. Google Cloud (proyecto `taurus-511717`): activar Sheets API y Drive API, cliente OAuth web con origen `http://localhost:4321` y cliente Android con paquete `com.taurus.app` y SHA-1 de la firma del APK.
5. Build del APK: `pnpm build:native`, luego en `android/` `gradlew.bat assembleDebug`; requiere JDK 21 y Android SDK (`platforms;android-35`, `build-tools;35.0.0`). Notas de entorno en la bóveda (`Entorno Android.md`).
