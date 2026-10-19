import { mergeSnapshots } from '../merge'
import type { Taurus } from '../taurus'
import type { Snapshot } from '../types'
import { fromSheets, SHEETS, toSheets } from './mapping'
import { addTabs, createSpreadsheet, findSpreadsheets, getTabs, readAll, writeAll } from './sheetsApi'

/** Nombre de la hoja compartida por todos los dispositivos (la encuentran buscándola en Drive). */
export const SHEET_NAME = 'Taurus — datos'

export interface SyncDeps {
  taurus: Pick<Taurus, 'snapshot' | 'apply'>
  /** Token de acceso; `interactive` solo en acciones del usuario. */
  token(interactive: boolean): Promise<string>
  getSheetId(): string | null
  setSheetId(id: string | null): void
}

const count = (s: Partial<Snapshot>) => Object.values(s).reduce((n, xs) => n + (xs?.length ?? 0), 0)

export function createSync(deps: SyncDeps) {
  /** Hoja a usar: la recordada; si no, la que ya exista en Drive; si no, una nueva. Repara pestañas faltantes. */
  async function resolveSheet(token: string): Promise<string> {
    const candidates = [deps.getSheetId(), ...(await findSpreadsheets(token, SHEET_NAME))].filter(Boolean) as string[]
    for (const id of candidates) {
      const tabs = await getTabs(token, id)
      if (!tabs) continue
      await addTabs(token, id, SHEETS.map(s => s.title).filter(t => !tabs.includes(t)))
      if (id !== deps.getSheetId()) deps.setSheetId(id)
      return id
    }
    const created = await createSpreadsheet(token, SHEET_NAME)
    deps.setSheetId(created.spreadsheetId)
    return created.spreadsheetId
  }

  return {
    /**
     * Sincronización bidireccional: lee la hoja, fusiona por id (gana la edición más reciente),
     * guarda localmente lo que faltaba y reescribe la hoja solo si quedó desactualizada.
     */
    async sync(interactive = false) {
      const token = await deps.token(interactive)
      const id = await resolveSheet(token)
      const remote = fromSheets(await readAll(token, id))
      const { merged, toLocal, remoteChanged } = mergeSnapshots(await deps.taurus.snapshot(), remote)
      const pulled = count(toLocal)
      if (pulled) await deps.taurus.apply(toLocal)
      if (remoteChanged) await writeAll(token, id, toSheets(merged))
      return { sheetId: id, pulled, pushed: remoteChanged }
    },
  }
}

export type Sync = ReturnType<typeof createSync>
