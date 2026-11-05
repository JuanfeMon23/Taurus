import { describe, it, expect } from 'vitest'
import { createApiStore, NETWORK_ERROR } from '../app/services/apiStore'
import { importLocalOnce, IMPORTED_KEY, LEGACY_KEY } from '../app/services/legacyImport'
import { createMemoryStore } from '../app/services/memoryStore'
import { emptySnapshot } from '../app/services/types'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function kvOf(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('apiStore', () => {
  it('load hace GET /snapshot y completa colecciones faltantes', async () => {
    const calls: string[] = []
    const s = createApiStore('http://x/api/v1/', async (u) => { calls.push(u); return json(200, { days: [{ id: '2026-01-01' }] }) })
    const snap = await s.load()
    expect(calls).toEqual(['http://x/api/v1/snapshot'])
    expect(snap.days).toHaveLength(1)
    expect(snap.services).toEqual([])
  })

  it('save hace PUT con el cuerpo JSON', async () => {
    let seen: RequestInit | undefined
    const s = createApiStore('http://x', async (_u, init) => { seen = init; return json(200, { applied: {}, skipped: {} }) })
    await s.save({ movements: [] })
    expect(seen?.method).toBe('PUT')
    expect(JSON.parse(seen!.body as string)).toEqual({ movements: [] })
  })

  it('error de red da un mensaje legible', async () => {
    const s = createApiStore('http://x', async () => { throw new TypeError('Failed to fetch') })
    await expect(s.load()).rejects.toThrow(NETWORK_ERROR)
  })

  it('422 muestra los mensajes, no el JSON crudo', async () => {
    const body = { code: 'validation', message: 'x', details: [{ campo: 'a', mensaje: 'Falta la distancia' }, { campo: 'b', mensaje: 'Monto inválido' }] }
    const s = createApiStore('http://x', async () => json(422, body))
    await expect(s.save({})).rejects.toThrow('Falta la distancia. Monto inválido')
  })

  it('500 da mensaje genérico legible', async () => {
    const s = createApiStore('http://x', async () => new Response('boom', { status: 500 }))
    await expect(s.load()).rejects.toThrow(/servidor local/)
  })
})

describe('importLocalOnce', () => {
  const stateV2 = JSON.stringify({ version: 2, ...emptySnapshot(), days: [{ id: '2026-01-01', date: '2026-01-01', km: 5, costs: [], updatedAt: '2026-01-01T00:00:00.000Z' }] })

  it('sube taurus-state si el backend está vacío, marca y no borra', async () => {
    const backend = createMemoryStore()
    const kv = kvOf({ [LEGACY_KEY]: stateV2 })
    expect(await importLocalOnce(backend, kv)).toBe(true)
    expect((await backend.load()).days).toHaveLength(1)
    expect(kv.m.has(IMPORTED_KEY)).toBe(true)
    expect(kv.m.get(LEGACY_KEY)).toBe(stateV2)
  })

  it('migra el formato anterior con fromLegacy', async () => {
    const backend = createMemoryStore()
    const old = { categories: [{ id: 1, name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }], days: { '2026-01-02': { date: '2026-01-02', km: 3, services: [{ amount: 1000 }], costs: [] } } }
    await importLocalOnce(backend, kvOf({ [LEGACY_KEY]: JSON.stringify(old) }))
    const snap = await backend.load()
    expect(snap.categories[0]!.id).toBe('cat-gasolina')
    expect(snap.services).toHaveLength(1)
  })

  it('no importa si el backend ya tiene datos', async () => {
    const backend = createMemoryStore()
    await backend.save({ days: [{ id: 'd', date: 'd', km: 1, costs: [], updatedAt: 'x' }] })
    const kv = kvOf({ [LEGACY_KEY]: stateV2 })
    expect(await importLocalOnce(backend, kv)).toBe(false)
    expect((await backend.load()).days).toHaveLength(1)
    expect(kv.m.has(IMPORTED_KEY)).toBe(true)
  })

  it('no importa dos veces', async () => {
    const backend = createMemoryStore()
    const kv = kvOf({ [LEGACY_KEY]: stateV2, [IMPORTED_KEY]: 'x' })
    expect(await importLocalOnce(backend, kv)).toBe(false)
    expect((await backend.load()).days).toHaveLength(0)
  })

  it('sin taurus-state no hace nada ni marca', async () => {
    const kv = kvOf()
    expect(await importLocalOnce(createMemoryStore(), kv)).toBe(false)
    expect(kv.m.has(IMPORTED_KEY)).toBe(false)
  })
})
