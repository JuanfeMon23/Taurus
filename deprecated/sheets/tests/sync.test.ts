import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'
import { createSync, SHEET_NAME } from '../app/services/sheets/sync'
import type { SheetRows } from '../app/services/sheets/mapping'

/** Google falso: Sheets + búsqueda en Drive, en memoria. */
function fakeGoogle() {
  const files = new Map<string, { name: string; created: number; tabs: Record<string, SheetRows> }>()
  const log: string[] = []
  let sheetCounter = 0
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const parsedUrl = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    log.push(`${method} ${parsedUrl.pathname}`)
    const json = (value: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: async () => value })

    if (parsedUrl.hostname === 'www.googleapis.com' && parsedUrl.pathname === '/drive/v3/files') {
      const list = [...files.entries()].filter(([, file]) => file.name === SHEET_NAME).sort(([, fileA], [, fileB]) => fileA.created - fileB.created)
      return json({ files: list.map(([id, file]) => ({ id, name: file.name })) })
    }
    const parts = parsedUrl.pathname.split('/') // ['', 'v4', 'spreadsheets', '<id>[:op]', 'values:op']
    if (parts.length === 3 && method === 'POST') {
      const id = `sheet-${++sheetCounter}`
      files.set(id, { name: body.properties.title, created: sheetCounter, tabs: Object.fromEntries(body.sheets.map((sheet: any) => [sheet.properties.title, []])) })
      return json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` })
    }
    const [id, op] = parts[3]!.split(':')
    const file = files.get(id!)
    if (!file) return json({ error: { message: 'not found' } }, 404)
    if (op === 'batchUpdate') {
      for (const request of body.requests) file.tabs[request.addSheet.properties.title] = []
      return json({})
    }
    if (!parts[4]) return json({ sheets: Object.keys(file.tabs).map(title => ({ properties: { title } })) })
    if (parts[4] === 'values:batchClear') { for (const title of body.ranges) file.tabs[title] = []; return json({}) }
    if (parts[4] === 'values:batchUpdate') {
      for (const valueRange of body.data) file.tabs[String(valueRange.range).split('!')[0]!] = valueRange.values
      return json({})
    }
    if (parts[4] === 'values:batchGet') {
      return json({ valueRanges: parsedUrl.searchParams.getAll('ranges').map(title => ({ range: title, values: file.tabs[title] })) })
    }
    return json({}, 400)
  })
  return { fn, files, log }
}

let google: ReturnType<typeof fakeGoogle>
beforeEach(() => {
  google = fakeGoogle()
  vi.stubGlobal('fetch', google.fn)
})
afterEach(() => vi.unstubAllGlobals())

/** Un dispositivo: su base local + su sincronizador (cada uno recuerda su propio id de hoja). */
async function device() {
  const taurus = createTaurus(createMemoryStore())
  await taurus.init()
  let sheetId: string | null = null
  const sync = createSync({ taurus: taurus, token: async () => 'tok', getSheetId: () => sheetId, setSheetId: id => { sheetId = id } })
  return { taurus, sync, sheetId: () => sheetId }
}
const writes = () => google.log.filter(logLine => logLine.endsWith('values:batchUpdate')).length

describe('sincronización bidireccional con Sheets', () => {
  it('la primera sincronización crea la hoja y sube todo', async () => {
    const deviceA = await device()
    await deviceA.taurus.saveDay({ date: '2026-10-15', km: 80, services: [{ amount: 100000 }] })
    await deviceA.sync.sync()
    expect(deviceA.sheetId()).toBe('sheet-1')
    expect(google.files.get('sheet-1')!.tabs.Servicios).toHaveLength(2)
  })

  it('otro dispositivo encuentra la misma hoja en Drive y trae lo que no tiene', async () => {
    const phone = await device()
    await phone.taurus.saveDay({ date: '2026-10-15', km: 80, services: [{ amount: 100000 }] })
    await phone.sync.sync()

    const desktop = await device()
    const result = await desktop.sync.sync()
    expect(desktop.sheetId()).toBe('sheet-1')
    expect(result.pulled).toBeGreaterThan(0)
    expect((await desktop.taurus.repo.getDay('2026-10-15'))!.gross).toBe(100000)
    expect(await desktop.taurus.repo.listCategories()).toHaveLength(2)
    expect(google.files.size).toBe(1)
  })

  it('registros de ambos lados terminan en los dos dispositivos', async () => {
    const deviceA = await device()
    const deviceB = await device()
    await deviceA.taurus.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await deviceB.taurus.saveDay({ date: '2026-10-15', km: 40, services: [{ amount: 20000 }] })
    await deviceA.sync.sync()
    await deviceB.sync.sync()
    await deviceA.sync.sync()
    for (const currentDevice of [deviceA, deviceB]) expect((await currentDevice.taurus.repo.listDays()).map(day => day.date)).toEqual(['2026-10-15', '2026-10-14'])
  })

  it('un borrado en un dispositivo se propaga al otro', async () => {
    const deviceA = await device()
    const deviceB = await device()
    await deviceA.taurus.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await deviceA.sync.sync()
    await deviceB.sync.sync()
    await deviceB.taurus.repo.deleteDay('2026-10-14')
    await deviceB.sync.sync()
    await deviceA.sync.sync()
    expect(await deviceA.taurus.repo.getDay('2026-10-14')).toBeNull()
  })

  it('sin cambios no reescribe la hoja', async () => {
    const deviceA = await device()
    await deviceA.sync.sync()
    const before = writes()
    const result = await deviceA.sync.sync()
    expect(writes()).toBe(before)
    expect(result.pushed).toBe(false)
  })

  it('si la hoja fue borrada, crea una nueva', async () => {
    const deviceA = await device()
    await deviceA.sync.sync()
    google.files.delete('sheet-1')
    await deviceA.sync.sync()
    expect(deviceA.sheetId()).toBe('sheet-2')
  })

  it('agrega pestañas que falten en una hoja existente', async () => {
    const deviceA = await device()
    await deviceA.sync.sync()
    delete google.files.get('sheet-1')!.tabs.Movimientos
    await deviceA.sync.sync()
    expect(google.files.get('sheet-1')!.tabs.Movimientos).toBeDefined()
  })
})
