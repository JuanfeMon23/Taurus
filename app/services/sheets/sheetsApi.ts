import { SHEETS, type SheetRows } from './mapping'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

export class SheetsError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).error?.message ?? detail } catch { /* sin cuerpo */ }
    throw new SheetsError(detail, res.status)
  }
  return res.json() as Promise<T>
}

export async function createSpreadsheet(token: string, title: string) {
  return call<{ spreadsheetId: string; spreadsheetUrl: string }>(token, BASE, {
    method: 'POST',
    body: JSON.stringify({ properties: { title }, sheets: SHEETS.map(s => ({ properties: { title: s.title } })) }),
  })
}

/** Busca en Drive las hojas con ese nombre creadas por esta app (scope drive.file); la más antigua primero. */
export async function findSpreadsheets(token: string, name: string) {
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  const r = await call<{ files: { id: string }[] }>(token, `${DRIVE}?q=${encodeURIComponent(q)}&orderBy=createdTime&fields=files(id)`)
  return r.files.map(f => f.id)
}

/** Títulos de las pestañas, o null si la hoja no existe / no es accesible. */
export async function getTabs(token: string, id: string): Promise<string[] | null> {
  try {
    const r = await call<{ sheets: { properties: { title: string } }[] }>(token, `${BASE}/${id}?fields=sheets.properties.title`)
    return r.sheets.map(s => s.properties.title)
  } catch (e) {
    if (e instanceof SheetsError && (e.status === 404 || e.status === 403)) return null
    throw e
  }
}

export async function addTabs(token: string, id: string, titles: string[]) {
  if (!titles.length) return
  await call(token, `${BASE}/${id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: titles.map(title => ({ addSheet: { properties: { title } } })) }),
  })
}

/** Reemplaza el contenido de todas las pestañas con el estado fusionado. */
export async function writeAll(token: string, id: string, data: Record<string, SheetRows>) {
  await call(token, `${BASE}/${id}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: SHEETS.map(s => s.title) }),
  })
  await call(token, `${BASE}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: SHEETS.map(s => ({ range: `${s.title}!A1`, values: data[s.title] ?? [[...s.headers]] })),
    }),
  })
}

export async function readAll(token: string, id: string): Promise<Record<string, SheetRows>> {
  const q = SHEETS.map(s => `ranges=${encodeURIComponent(s.title)}`).join('&')
  const r = await call<{ valueRanges: { range: string; values?: SheetRows }[] }>(
    token, `${BASE}/${id}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`,
  )
  return Object.fromEntries(SHEETS.map((s, i) => [s.title, r.valueRanges[i]?.values ?? []]))
}
