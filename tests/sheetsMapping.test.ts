import { describe, it, expect } from 'vitest'
import { fromSheets, toSheets, SHEETS } from '../app/services/sheets/mapping'
import { emptySnapshot, type Snapshot } from '../app/services/types'

const T = '2026-10-15T12:00:00.000Z'
const snap: Snapshot = {
  categories: [
    { id: 'cat-gasolina', name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true, updatedAt: T },
    { id: 'c2', name: 'Servicio moto', rateMode: 'derived', totalCost: 160000, intervalKm: 3500, active: false, updatedAt: T },
  ],
  days: [{ id: '2026-10-15', date: '2026-10-15', km: 80, note: 'lluvia', updatedAt: T,
    costs: [{ categoryId: 'cat-gasolina', name: 'Gasolina', rate: 100, amount: 8000 }] }],
  services: [
    { id: 's1', date: '2026-10-15', amount: 100000, method: 'cash', updatedAt: T },
    { id: 's2', date: '2026-10-15', amount: 50000, method: 'transfer', note: 'aeropuerto', updatedAt: T },
    { id: 's3', date: '2026-10-15', amount: 999, method: 'cash', updatedAt: T, deleted: true },
  ],
  cash: [{ id: '2026-10-15', date: '2026-10-15', opening: 50000, openedAt: T, closedAt: T, counted: 190000, updatedAt: T }],
  movements: [
    { id: 'm1', date: '2026-10-15', type: 'expense', amount: 8000, note: 'almuerzo', updatedAt: T },
    { id: 'm2', date: '2026-10-15', type: 'deposit', amount: 20000, updatedAt: T },
  ],
}

describe('mapeo a Google Sheets', () => {
  it('genera una hoja por colección con encabezado', () => {
    const s = toSheets(snap)
    expect(Object.keys(s)).toEqual(SHEETS.map(x => x.title))
    for (const sheet of SHEETS) expect(s[sheet.title]![0]).toEqual(sheet.headers)
  })

  it('cada registro lleva su id único; las lápidas también viajan', () => {
    const s = toSheets(snap)
    expect(s.Servicios!.slice(1).map(r => r[0])).toEqual(['s1', 's2', 's3'])
    expect(s.Servicios![3]!.at(-1)).toBe(1)
  })

  it('Dias muestra bruto y neto calculados (solo informativos)', () => {
    const dia = toSheets(snap).Dias![1]!
    expect(dia.slice(0, 6)).toEqual(['2026-10-15', 80, 'lluvia', 150000, 8000, 142000])
  })

  it('ida y vuelta conserva todo', () => {
    expect(fromSheets(toSheets(snap))).toEqual(snap)
  })

  it('celdas vacías o con texto numérico no rompen la importación', () => {
    const s = toSheets(snap)
    s.Servicios![1]![2] = '100000'
    s.Servicios![1]![4] = ''
    const back = fromSheets(s)
    expect(back.services[0]!.amount).toBe(100000)
    expect(back.services[0]!.note).toBeUndefined()
  })

  it('filas sin id o sin fecha de edición se ignoran', () => {
    const s = toSheets(snap)
    s.Servicios!.push(['', '2026-10-15', 5, 'cash', '', T, ''])
    s.Servicios!.push(['s9', '2026-10-15', 5, 'cash', '', '', ''])
    expect(fromSheets(s).services).toHaveLength(3)
  })

  it('hojas ausentes producen un snapshot vacío', () => {
    expect(fromSheets({})).toEqual(emptySnapshot())
  })
})
