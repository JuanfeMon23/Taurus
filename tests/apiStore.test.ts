import { describe, it, expect } from 'vitest'
import { createApiStore, NETWORK_ERROR } from '../app/services/apiStore'
import { importLocalOnce, IMPORTED_KEY, LEGACY_KEY } from '../app/services/legacyImport'
import { createMemoryStore } from '../app/services/memoryStore'
import { emptySnapshot } from '../app/services/types'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function kvOf(init: Record<string, string> = {}) {
  const entries = new Map(Object.entries(init))
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => void entries.set(key, value), entries }
}

describe('apiStore', () => {
  it('load hace GET /snapshot y completa colecciones faltantes', async () => {
    const calls: string[] = []
    const store = createApiStore('http://x/api/v1/', async (url) => { calls.push(url); return json(200, { days: [{ id: '2026-01-01' }] }) })
    const snapshot = await store.load()
    expect(calls).toEqual(['http://x/api/v1/snapshot'])
    expect(snapshot.days).toHaveLength(1)
    expect(snapshot.services).toEqual([])
    expect(snapshot.settings).toEqual([])
  })

  it('load conserva settings y los campos de comisión del servicio', async () => {
    const body = {
      settings: [{ id: 'rates', commissionRate: 0.095, vatRate: 0.19, updatedAt: 'x', deleted: false }],
      services: [{ id: 's', isIndrive: true, commission: 855, commissionVat: 162.45 }],
    }
    const snapshot = await createApiStore('http://x', async () => json(200, body)).load()
    expect(snapshot.settings[0]).toMatchObject({ id: 'rates', commissionRate: 0.095 })
    expect(snapshot.services[0]).toMatchObject({ isIndrive: true, commission: 855, commissionVat: 162.45 })
  })

  it('save hace PUT con el cuerpo JSON', async () => {
    let seen: RequestInit | undefined
    const store = createApiStore('http://x', async (_url, init) => { seen = init; return json(200, { applied: {}, skipped: {} }) })
    await store.save({ movements: [] })
    expect(seen?.method).toBe('PUT')
    expect(JSON.parse(seen!.body as string)).toEqual({ movements: [] })
  })

  it('error de red da un mensaje legible', async () => {
    const store = createApiStore('http://x', async () => { throw new TypeError('Failed to fetch') })
    await expect(store.load()).rejects.toThrow(NETWORK_ERROR)
  })

  it('422 muestra los mensajes, no el JSON crudo', async () => {
    const body = { code: 'validation', message: 'x', details: [{ campo: 'a', mensaje: 'Falta la distancia' }, { campo: 'b', mensaje: 'Monto inválido' }] }
    const store = createApiStore('http://x', async () => json(422, body))
    await expect(store.save({})).rejects.toThrow('Falta la distancia. Monto inválido')
  })

  it('500 da mensaje genérico legible', async () => {
    const store = createApiStore('http://x', async () => new Response('boom', { status: 500 }))
    await expect(store.load()).rejects.toThrow(/servidor local/)
  })
})

describe('importLocalOnce', () => {
  const stateV2 = JSON.stringify({ version: 2, ...emptySnapshot(), days: [{ id: '2026-01-01', date: '2026-01-01', km: 5, costs: [], updatedAt: '2026-01-01T00:00:00.000Z' }] })

  it('sube taurus-state si el backend está vacío, marca y no borra', async () => {
    const backend = createMemoryStore()
    const kv = kvOf({ [LEGACY_KEY]: stateV2 })
    expect(await importLocalOnce(backend, kv)).toBe(true)
    expect((await backend.load()).days).toHaveLength(1)
    expect(kv.entries.has(IMPORTED_KEY)).toBe(true)
    expect(kv.entries.get(LEGACY_KEY)).toBe(stateV2)
  })

  it('migra el formato anterior con fromLegacy', async () => {
    const backend = createMemoryStore()
    const old = { categories: [{ id: 1, name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true }], days: { '2026-01-02': { date: '2026-01-02', km: 3, services: [{ amount: 1000 }], costs: [] } } }
    await importLocalOnce(backend, kvOf({ [LEGACY_KEY]: JSON.stringify(old) }))
    const snapshot = await backend.load()
    expect(snapshot.categories[0]!.id).toBe('cat-gasolina')
    expect(snapshot.services).toHaveLength(1)
  })

  it('no importa si el backend ya tiene datos', async () => {
    const backend = createMemoryStore()
    await backend.save({ days: [{ id: 'd', date: 'd', km: 1, costs: [], updatedAt: 'x' }] })
    const kv = kvOf({ [LEGACY_KEY]: stateV2 })
    expect(await importLocalOnce(backend, kv)).toBe(false)
    expect((await backend.load()).days).toHaveLength(1)
    expect(kv.entries.has(IMPORTED_KEY)).toBe(true)
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
    expect(kv.entries.has(IMPORTED_KEY)).toBe(false)
  })
})
