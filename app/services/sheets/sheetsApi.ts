import { SHEETS, type SheetRows } from './mapping'

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

export class SheetsError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    let detail = response.statusText
    try { detail = (await response.json()).error?.message ?? detail } catch { /* sin cuerpo */ }
    throw new SheetsError(detail, response.status)
  }
  return response.json() as Promise<T>
}

export async function createSpreadsheet(token: string, title: string) {
  return call<{ spreadsheetId: string; spreadsheetUrl: string }>(token, BASE, {
    method: 'POST',
    body: JSON.stringify({ properties: { title }, sheets: SHEETS.map(sheet => ({ properties: { title: sheet.title } })) }),
  })
}

/** Busca en Drive las hojas con ese nombre creadas por esta app (scope drive.file); la más antigua primero. */
export async function findSpreadsheets(token: string, name: string) {
  const query = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  const response = await call<{ files: { id: string }[] }>(token, `${DRIVE}?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=files(id)`)
  return response.files.map(file => file.id)
}

/** Títulos de las pestañas, o null si la hoja no existe / no es accesible. */
export async function getTabs(token: string, id: string): Promise<string[] | null> {
  try {
    const response = await call<{ sheets: { properties: { title: string } }[] }>(token, `${BASE}/${id}?fields=sheets.properties.title`)
    return response.sheets.map(sheet => sheet.properties.title)
  } catch (error) {
    if (error instanceof SheetsError && (error.status === 404 || error.status === 403)) return null
    throw error
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
    body: JSON.stringify({ ranges: SHEETS.map(sheet => sheet.title) }),
  })
  await call(token, `${BASE}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: SHEETS.map(sheet => ({ range: `${sheet.title}!A1`, values: data[sheet.title] ?? [[...sheet.headers]] })),
    }),
  })
}

export async function readAll(token: string, id: string): Promise<Record<string, SheetRows>> {
  const rangesQuery = SHEETS.map(sheet => `ranges=${encodeURIComponent(sheet.title)}`).join('&')
  const response = await call<{ valueRanges: { range: string; values?: SheetRows }[] }>(
    token, `${BASE}/${id}/values:batchGet?${rangesQuery}&valueRenderOption=UNFORMATTED_VALUE`,
  )
  return Object.fromEntries(SHEETS.map((sheet, i) => [sheet.title, response.valueRanges[i]?.values ?? []]))
}
