import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'
import { createSync, SHEET_NAME } from '../app/services/sheets/sync'
import type { SheetRows } from '../app/services/sheets/mapping'

/** Google falso: Sheets + búsqueda en Drive, en memoria. */
function fakeGoogle() {
  const files = new Map<string, { name: string; created: number; tabs: Record<string, SheetRows> }>()
  const log: string[] = []
  let n = 0
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    log.push(`${method} ${u.pathname}`)
    const json = (v: unknown, status = 200) => ({ ok: status < 400, status, statusText: 'x', json: async () => v })

    if (u.hostname === 'www.googleapis.com' && u.pathname === '/drive/v3/files') {
      const list = [...files.entries()].filter(([, f]) => f.name === SHEET_NAME).sort((a, b) => a[1].created - b[1].created)
      return json({ files: list.map(([id, f]) => ({ id, name: f.name })) })
    }
    const parts = u.pathname.split('/') // ['', 'v4', 'spreadsheets', '<id>[:op]', 'values:op']
    if (parts.length === 3 && method === 'POST') {
      const id = `sheet-${++n}`
      files.set(id, { name: body.properties.title, created: n, tabs: Object.fromEntries(body.sheets.map((s: any) => [s.properties.title, []])) })
      return json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` })
    }
    const [id, op] = parts[3]!.split(':')
    const f = files.get(id!)
    if (!f) return json({ error: { message: 'not found' } }, 404)
    if (op === 'batchUpdate') {
      for (const r of body.requests) f.tabs[r.addSheet.properties.title] = []
      return json({})
    }
    if (!parts[4]) return json({ sheets: Object.keys(f.tabs).map(title => ({ properties: { title } })) })
    if (parts[4] === 'values:batchClear') { for (const t of body.ranges) f.tabs[t] = []; return json({}) }
    if (parts[4] === 'values:batchUpdate') {
      for (const d of body.data) f.tabs[String(d.range).split('!')[0]!] = d.values
      return json({})
    }
    if (parts[4] === 'values:batchGet') {
      return json({ valueRanges: u.searchParams.getAll('ranges').map(t => ({ range: t, values: f.tabs[t] })) })
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
  const t = createTaurus(createMemoryStore())
  await t.init()
  let sheetId: string | null = null
  const sync = createSync({ taurus: t, token: async () => 'tok', getSheetId: () => sheetId, setSheetId: id => { sheetId = id } })
  return { t, sync, sheetId: () => sheetId }
}
const writes = () => google.log.filter(l => l.endsWith('values:batchUpdate')).length

describe('sincronización bidireccional con Sheets', () => {
  it('la primera sincronización crea la hoja y sube todo', async () => {
    const a = await device()
    await a.t.saveDay({ date: '2026-10-15', km: 80, services: [{ amount: 100000 }] })
    await a.sync.sync()
    expect(a.sheetId()).toBe('sheet-1')
    expect(google.files.get('sheet-1')!.tabs.Servicios).toHaveLength(2)
  })

  it('otro dispositivo encuentra la misma hoja en Drive y trae lo que no tiene', async () => {
    const phone = await device()
    await phone.t.saveDay({ date: '2026-10-15', km: 80, services: [{ amount: 100000 }] })
    await phone.sync.sync()

    const desktop = await device()
    const r = await desktop.sync.sync()
    expect(desktop.sheetId()).toBe('sheet-1')
    expect(r.pulled).toBeGreaterThan(0)
    expect((await desktop.t.repo.getDay('2026-10-15'))!.gross).toBe(100000)
    expect(await desktop.t.repo.listCategories()).toHaveLength(2)
    expect(google.files.size).toBe(1)
  })

  it('registros de ambos lados terminan en los dos dispositivos', async () => {
    const a = await device()
    const b = await device()
    await a.t.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await b.t.saveDay({ date: '2026-10-15', km: 40, services: [{ amount: 20000 }] })
    await a.sync.sync()
    await b.sync.sync()
    await a.sync.sync()
    for (const d of [a, b]) expect((await d.t.repo.listDays()).map(x => x.date)).toEqual(['2026-10-15', '2026-10-14'])
  })

  it('un borrado en un dispositivo se propaga al otro', async () => {
    const a = await device()
    const b = await device()
    await a.t.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await a.sync.sync()
    await b.sync.sync()
    await b.t.repo.deleteDay('2026-10-14')
    await b.sync.sync()
    await a.sync.sync()
    expect(await a.t.repo.getDay('2026-10-14')).toBeNull()
  })

  it('sin cambios no reescribe la hoja', async () => {
    const a = await device()
    await a.sync.sync()
    const before = writes()
    const r = await a.sync.sync()
    expect(writes()).toBe(before)
    expect(r.pushed).toBe(false)
  })

  it('si la hoja fue borrada, crea una nueva', async () => {
    const a = await device()
    await a.sync.sync()
    google.files.delete('sheet-1')
    await a.sync.sync()
    expect(a.sheetId()).toBe('sheet-2')
  })

  it('agrega pestañas que falten en una hoja existente', async () => {
    const a = await device()
    await a.sync.sync()
    delete google.files.get('sheet-1')!.tabs.Movimientos
    await a.sync.sync()
    expect(google.files.get('sheet-1')!.tabs.Movimientos).toBeDefined()
  })
})
