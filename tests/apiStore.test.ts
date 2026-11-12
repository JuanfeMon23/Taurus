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

  it('load conserva fundMovements y completa la colección si falta', async () => {
    const withFunds = await createApiStore('http://x', async () => json(200, { fundMovements: [{ id: 'f', categoryId: 'cat-gasolina', type: 'transfer', amount: 1, date: '2026-11-01', updatedAt: 'x', deleted: false }] })).load()
    expect(withFunds.fundMovements).toHaveLength(1)
    expect((await createApiStore('http://x', async () => json(200, {})).load()).fundMovements).toEqual([])
    expect((await createApiStore('http://x', async () => json(200, {})).load()).shifts).toEqual([])
    const withShifts = await createApiStore('http://x', async () => json(200, { shifts: [{ id: 's', date: '2026-11-06', startTime: '06:00', updatedAt: 'x', deleted: false }] })).load()
    expect(withShifts.shifts).toHaveLength(1)
  })

  it('load conserva plantillas de turno y catálogos, y los completa vacíos si faltan', async () => {
    const body = {
      shiftTemplates: [{ id: 't', name: 'Mediodía', startTime: '12:00', endTime: '14:00', sortOrder: 0, active: true, updatedAt: 'x', deleted: false }],
      paymentMethods: [{ id: 'cash', name: 'Efectivo', affectsCash: true, sortOrder: 0, active: true, updatedAt: 'x', deleted: false }],
      shifts: [{ id: 's', date: '2026-11-06', startTime: '12:00', templateId: 't', updatedAt: 'x', deleted: false }],
      movements: [{ id: 'm', date: '2026-11-06', type: 'expense', amount: 1, categoryId: 'comida', method: 'cash', updatedAt: 'x', deleted: false }],
    }
    const loaded = await createApiStore('http://x', async () => json(200, body)).load()
    expect(loaded.shiftTemplates[0]).toMatchObject({ name: 'Mediodía' })
    expect(loaded.paymentMethods).toHaveLength(1)
    expect(loaded.shifts[0]).toMatchObject({ templateId: 't' })
    expect(loaded.movements[0]).toMatchObject({ categoryId: 'comida' })
    const empty = await createApiStore('http://x', async () => json(200, {})).load()
    expect([empty.shiftTemplates, empty.paymentMethods, empty.movementTypes, empty.fundMovementTypes, empty.expenseCategories]).toEqual([[], [], [], [], []])
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

  it('load conserva los modos de tarifa y los completa vacíos si faltan', async () => {
    const body = { rateModes: [{ id: 'direct', name: 'Valor por km', usesRatePerKm: true, usesCostInterval: false, sortOrder: 0, active: true, updatedAt: 'x', deleted: false }] }
    const loaded = await createApiStore('http://x', async () => json(200, body)).load()
    expect(loaded.rateModes[0]).toMatchObject({ id: 'direct', usesRatePerKm: true, usesCostInterval: false })
    expect((await createApiStore('http://x', async () => json(200, {})).load()).rateModes).toEqual([])
  })

  it('422 unknown_catalog_code se traduce a una frase legible con el código y el campo', async () => {
    const body = { code: 'unknown_catalog_code', message: 'Unknown', details: [{ campo: 'categories.rateMode', mensaje: 'Código de catálogo desconocido: nope' }] }
    const store = createApiStore('http://x', async () => json(422, body))
    const error = await store.save({ categories: [] }).catch(caught => caught as Error)
    expect(error.message).toContain('«nope»')
    expect(error.message).toContain('modo de tarifa')
    expect(error.message).toContain('Tarifas > Catálogos')
    expect(error.message).not.toContain('{')
  })

  it('422 unknown_catalog_code de services.shiftId pide volver a elegir el turno', async () => {
    const body = { code: 'unknown_catalog_code', message: 'Unknown', details: [{ campo: 'services.shiftId', mensaje: 'Código de catálogo desconocido: abc' }] }
    const store = createApiStore('http://x', async () => json(422, body))
    const error = await store.save({ services: [] }).catch(caught => caught as Error)
    expect(error.message).toContain('turno de un viaje ya no existe')
  })

  it('422 por viaje sin turno (services.shiftId) pide asignar turno, sea cual sea el code', async () => {
    const body = { code: 'validation_error', message: 'x', details: [{ campo: 'services.shiftId', mensaje: 'El viaje necesita turno' }] }
    const store = createApiStore('http://x', async () => json(422, body))
    const error = await store.save({ services: [] }).catch(caught => caught as Error)
    expect(error.message).toBe('Hay viajes de este día sin turno; asígnales uno')
  })

  it('422 unknown_catalog_code sin detalles usa una frase general', async () => {
    const store = createApiStore('http://x', async () => json(422, { code: 'unknown_catalog_code', message: 'x' }))
    const error = await store.save({}).catch(caught => caught as Error)
    expect(error.message).toContain('Tarifas > Catálogos')
  })

  it('422 unknown_catalog_code de una cuenta nombra la cuenta, no el medio de pago', async () => {
    const body = { code: 'unknown_catalog_code', message: 'x', details: [
      { campo: 'movements.accountId', mensaje: 'Código de catálogo desconocido: banco' },
      { campo: 'movements.toAccountId', mensaje: 'Código de catálogo desconocido: ahorros' },
      { campo: 'paymentMethods.accountId', mensaje: 'Código de catálogo desconocido: nequi-cuenta' },
    ] }
    const error = await createApiStore('http://x', async () => json(422, body)).save({}).catch(caught => caught as Error)
    expect(error.message).toContain('La opción «banco» de la cuenta del movimiento')
    expect(error.message).toContain('«ahorros» de la cuenta de destino')
    expect(error.message).toContain('«nequi-cuenta» de la cuenta del medio de pago')
  })

  it('422 account_rule_violation explica la regla en español', async () => {
    const affects = { code: 'account_rule_violation', message: 'x', details: [{ campo: 'paymentMethods.affectsCash', mensaje: 'affectsCash must match' }] }
    const affectsError = await createApiStore('http://x', async () => json(422, affects)).save({}).catch(caught => caught as Error)
    expect(affectsError.message).toMatch(/medio de pago.*caja/)
    expect(affectsError.message).not.toContain('must match')
    const destination = { code: 'account_rule_violation', message: 'x', details: [{ campo: 'movements.toAccountId', mensaje: 'destination required' }] }
    const destinationError = await createApiStore('http://x', async () => json(422, destination)).save({}).catch(caught => caught as Error)
    expect(destinationError.message).toMatch(/traslado.*destino/)
    const generic = await createApiStore('http://x', async () => json(422, { code: 'account_rule_violation', message: 'x' })).save({}).catch(caught => caught as Error)
    expect(generic.message).toContain('cuentas')
  })

  it('el 422 account_rule_violation de la cuenta de comisión llega con su frase', async () => {
    const respond = (campo: string) => createApiStore('http://x', async () => json(422, { code: 'account_rule_violation', message: 'x', details: [{ campo, mensaje: 'x' }] })).save({}).catch(caught => caught as Error)
    expect((await respond('accounts.commissionSince')).message).toContain('Solo una cuenta puede ser la de comisión')
    expect((await respond('paymentMethods.accountId')).message).toContain('Un medio de pago no puede apuntar a la cuenta de comisión')
    expect((await respond('accounts.active')).message).toContain('Una cuenta con movimientos no se puede desactivar ni borrar')
  })

  it('load conserva las cuentas, completa vacío si faltan y descarta depositMovements', async () => {
    const body = { accounts: [{ id: 'caja', name: 'Caja', initialBalance: 0, isCashBox: true, sortOrder: 0, active: true, updatedAt: 'x', deleted: false }], depositMovements: [] }
    const loaded = await createApiStore('http://x', async () => json(200, body)).load()
    expect(loaded.accounts).toHaveLength(1)
    expect('depositMovements' in loaded).toBe(false)
    expect((await createApiStore('http://x', async () => json(200, {})).load()).accounts).toEqual([])
  })

  it('commissionSince de una cuenta se conserva al cargar y se envía tal cual al guardar', async () => {
    const indrive = { id: 'indrive', name: 'Saldo inDrive', initialBalance: 0, isCashBox: false, sortOrder: 5, active: true, commissionSince: '2026-11-12', updatedAt: 'x', deleted: false }
    const loaded = await createApiStore('http://x', async () => json(200, { accounts: [indrive] })).load()
    expect(loaded.accounts[0]!.commissionSince).toBe('2026-11-12')
    let sent: unknown
    await createApiStore('http://x', async (_url, init) => { sent = JSON.parse(String(init?.body)); return json(200, {}) }).save({ accounts: loaded.accounts })
    expect((sent as { accounts: { commissionSince?: string }[] }).accounts[0]!.commissionSince).toBe('2026-11-12')
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

  it('un taurus-state con salidas del depósito y movimientos con medio sube todo con cuenta (depositMovements ya no viaja)', async () => {
    const backend = createMemoryStore()
    await backend.save({
      accounts: [{ id: 'caja', name: 'Caja', initialBalance: 0, isCashBox: true, sortOrder: 0, active: true, updatedAt: 'x' }, { id: 'transferencias', name: 'Transferencias', initialBalance: 0, isCashBox: false, sortOrder: 1, active: true, updatedAt: 'x' }],
      paymentMethods: [{ id: 'cash', name: 'Efectivo', accountId: 'caja', affectsCash: true, sortOrder: 0, active: true, updatedAt: 'x' }, { id: 'transfer', name: 'Transferencia', accountId: 'transferencias', affectsCash: false, sortOrder: 1, active: true, updatedAt: 'x' }],
    })
    const old = JSON.stringify({
      version: 2, ...emptySnapshot(),
      movements: [{ id: 'm1', date: '2026-01-01', type: 'expense', amount: 5, method: 'transfer', updatedAt: 'x' }, { id: 'm2', date: '2026-01-01', type: 'expense', amount: 6, updatedAt: 'x' }],
      depositMovements: [{ id: 'd1', date: '2026-01-02', amount: 7000, note: 'moto', updatedAt: 'x' }, { id: 'd2', date: '2026-01-03', amount: 1, updatedAt: 'x', deleted: true }],
    })
    expect(await importLocalOnce(backend, kvOf({ [LEGACY_KEY]: old }))).toBe(true)
    const { movements } = await backend.load()
    expect(movements.map(movement => [movement.id, movement.type, movement.accountId, 'method' in movement])).toEqual([
      ['m1', 'expense', 'transferencias', false], ['m2', 'expense', 'caja', false], ['d1', 'withdrawal', 'deposito', false],
    ])
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
