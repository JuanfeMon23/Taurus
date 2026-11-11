import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'
import { mergeSnapshots } from '../app/services/merge'
import { ApiError } from '../app/services/apiStore'

async function setup() {
  const taurus = createTaurus(createMemoryStore())
  await taurus.init()
  return taurus
}

describe('taurus (dominio)', () => {
  it('siembra Gasolina y Servicio una sola vez, con ids fijos', async () => {
    const taurus = await setup()
    await taurus.init()
    const categories = await taurus.repo.listCategories()
    expect(categories.map(category => [category.id, category.name])).toEqual([['cat-gasolina', 'Gasolina'], ['cat-servicio-moto', 'Servicio moto']])
  })

  it('guarda el día con costos y neto; cada servicio recibe un id único', async () => {
    const taurus = await setup()
    const day = await taurus.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 120000 }, { amount: 80000 }] })
    expect(day.gross).toBe(200000)
    expect(day.net).toBeCloseTo(185428.57, 1)
    const ids = day.services.map(service => service.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => typeof id === 'string' && id.length >= 16)).toBe(true)
  })

  it('cambiar una tarifa no altera días ya guardados', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    const [gas] = await taurus.repo.listCategories()
    await taurus.repo.saveCategory({ ...gas!, ratePerKm: 200 })
    expect((await taurus.repo.getDay('2026-10-14'))!.costs[0]!.amount).toBe(10000)
  })

  it('recalcDay aplica las tarifas actuales', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    const [gas] = await taurus.repo.listCategories()
    await taurus.repo.saveCategory({ ...gas!, ratePerKm: 200 })
    expect((await taurus.recalcDay('2026-10-14'))!.costs[0]!.amount).toBe(20000)
  })

  it('una categoría nueva solo afecta días posteriores', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-10-13', km: 100, services: [{ amount: 100000 }] })
    await taurus.repo.saveCategory({ name: 'Seguro', rateMode: 'direct', ratePerKm: 10, active: true })
    await taurus.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    expect((await taurus.repo.getDay('2026-10-13'))!.costs).toHaveLength(2)
    expect((await taurus.repo.getDay('2026-10-14'))!.costs).toHaveLength(3)
  })

  it('re-guardar conserva ids y deja lápida del servicio quitado', async () => {
    const taurus = await setup()
    const day = await taurus.saveDay({ date: '2026-10-14', km: 10, services: [{ amount: 1000 }, { amount: 2000 }] })
    const [keep] = day.services
    const again = await taurus.saveDay({ date: '2026-10-14', km: 10, services: [{ ...keep!, amount: 1500 }] })
    expect(again.services.map(service => service.id)).toEqual([keep!.id])
    expect(again.gross).toBe(1500)
    const snapshot = await taurus.snapshot()
    expect(snapshot.services.filter(service => service.deleted)).toHaveLength(1)
  })

  it('borrar un día lo oculta y deja lápidas', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-10-14', km: 10, services: [{ amount: 1000 }] })
    await taurus.repo.deleteDay('2026-10-14')
    expect(await taurus.repo.getDay('2026-10-14')).toBeNull()
    expect(await taurus.repo.listDays()).toHaveLength(0)
    const snapshot = await taurus.snapshot()
    expect(snapshot.days[0]!.deleted).toBe(true)
    expect(snapshot.services[0]!.deleted).toBe(true)
  })

  it('caja: movimientos con id único y lápida al quitarlos', async () => {
    const taurus = await setup()
    await taurus.repo.putCash({ date: '2026-10-14', opening: 50000, openedAt: 'x', movements: [
      { id: '', type: 'expense', amount: 8000 }, { id: '', type: 'deposit', amount: 1000 }] })
    const cashDay = (await taurus.repo.getCash('2026-10-14'))!
    expect(new Set(cashDay.movements.map(movement => movement.id)).size).toBe(2)
    await taurus.repo.putCash({ ...cashDay, movements: [cashDay.movements[0]!] })
    expect((await taurus.repo.getCash('2026-10-14'))!.movements).toHaveLength(1)
    expect((await taurus.snapshot()).movements.filter(movement => movement.deleted)).toHaveLength(1)
  })

  it('dos dispositivos: el registro del otro se agrega al fusionar', async () => {
    const phone = await setup()
    const desktop = await setup()
    await phone.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await desktop.saveDay({ date: '2026-10-15', km: 40, services: [{ amount: 20000, method: 'transfer' }] })

    const mergeResult = mergeSnapshots(await phone.snapshot(), await desktop.snapshot())
    await phone.apply(mergeResult.toLocal)
    expect((await phone.repo.listDays()).map(day => day.date)).toEqual(['2026-10-15', '2026-10-14'])
    expect((await phone.repo.getDay('2026-10-15'))!.services[0]!.method).toBe('transfer')
    // Las categorías sembradas con id fijo no se duplican.
    expect(await phone.repo.listCategories()).toHaveLength(2)
  })
})

describe('taurus (datos de viaje)', () => {
  it('guarda y devuelve datos de viaje; los servicios viejos no los tienen', async () => {
    const taurus = await setup()
    await taurus.saveDay({
      date: '2026-11-04', km: 10,
      services: [
        { amount: 10000 },
        { amount: 20000, startTime: '23:30', endTime: '00:10', distanceKm: 4.5, origin: 'A', destination: 'B' },
      ],
    })
    const day = (await taurus.repo.getDay('2026-11-04'))!
    expect(day.services[0]!.startTime).toBeUndefined()
    expect(day.services[1]).toMatchObject({ startTime: '23:30', endTime: '00:10', distanceKm: 4.5, origin: 'A', destination: 'B' })
  })
})

describe('taurus (turno del viaje)', () => {
  it('guarda el shiftId del viaje, lo devuelve y lo quita al desligar', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-11-10', km: 5, services: [{ amount: 100, shiftId: 'turno-1' }, { amount: 200 }] })
    const saved = (await taurus.repo.getDay('2026-11-10'))!
    expect(saved.services[0]!.shiftId).toBe('turno-1')
    expect(saved.services[1]!.shiftId).toBeUndefined()
    await taurus.saveDay({ date: '2026-11-10', km: 5, services: saved.services.map(({ shiftId: _unlinked, ...rest }) => rest) })
    expect((await taurus.repo.getDay('2026-11-10'))!.services[0]!.shiftId).toBeUndefined()
  })
})

describe('taurus: depósito', () => {
  it('guarda toDeposit en la caja y lo lee de vuelta', async () => {
    const taurus = await setup()
    await taurus.repo.putCash({ date: '2026-11-03', opening: 1000, openedAt: 'x', movements: [], closedAt: 'y', counted: 5000, toDeposit: 3000 })
    expect((await taurus.repo.getCash('2026-11-03'))?.toDeposit).toBe(3000)
    await taurus.repo.putCash({ date: '2026-11-03', opening: 1000, openedAt: 'x', movements: [] })
    expect((await taurus.repo.getCash('2026-11-03'))?.toDeposit).toBeUndefined()
  })

  it('una salida del depósito es un movimiento de la cuenta deposito: se lista y se elimina con lápida', async () => {
    const taurus = await setup()
    await taurus.repo.putCash({ date: '2026-11-03', opening: 0, openedAt: 'x', movements: [{ id: '', type: 'withdrawal', amount: 20000, note: 'banco', accountId: 'deposito' }] })
    const [outflow] = await taurus.repo.listMovements()
    expect(outflow).toMatchObject({ date: '2026-11-03', type: 'withdrawal', amount: 20000, note: 'banco', accountId: 'deposito' })
    await taurus.repo.deleteMovement(outflow!.id)
    expect(await taurus.repo.listMovements()).toEqual([])
    expect((await taurus.snapshot()).movements[0]!.deleted).toBe(true)
  })

  it('un almacén local con salidas del depósito antiguas las vuelve movimientos de la cuenta deposito, una sola vez', async () => {
    const saved = JSON.stringify({
      version: 2,
      paymentMethods: [{ id: 'cash', name: 'Efectivo', affectsCash: true, sortOrder: 0, active: true, updatedAt: 'x' }],
      depositMovements: [{ id: 'old', date: '2026-10-01', amount: 7000, note: 'moto', updatedAt: 'x' }, { id: 'gone', date: '2026-10-02', amount: 1, updatedAt: 'x', deleted: true }],
    })
    const store = createMemoryStore({ getItem: () => saved, setItem: () => {} })
    const taurus = createTaurus(store)
    await taurus.init()
    expect((await taurus.repo.listMovements()).map(movement => [movement.id, movement.type, movement.amount, movement.accountId])).toEqual([['old', 'withdrawal', 7000, 'deposito']])
    await taurus.repo.deleteMovement('old')
    await createTaurus(store).init()
    expect(await taurus.repo.listMovements()).toEqual([])
  })

  it('un almacén local sin cuentas las siembra y asigna cuenta a sus medios de pago', async () => {
    const store = createMemoryStore()
    await store.save({ paymentMethods: [
      { id: 'cash', name: 'Efectivo', affectsCash: true, sortOrder: 0, active: true, updatedAt: 'x' },
      { id: 'transfer', name: 'Transferencia', affectsCash: false, sortOrder: 1, active: true, updatedAt: 'x' },
    ] as never })
    const taurus = createTaurus(store)
    await taurus.init()
    const catalogs = await taurus.repo.listCatalogs()
    expect(catalogs.accounts.map(account => [account.id, account.isCashBox])).toEqual([['caja', true], ['transferencias', false], ['deposito', false]])
    expect(catalogs.paymentMethods.map(method => [method.id, method.accountId])).toEqual([['cash', 'caja'], ['transfer', 'transferencias']])
    expect(catalogs.movementTypes.some(type => type.id === 'traslado' && type.requiresDestination)).toBe(true)
  })

  it('turnos: guarda, lista por fecha ordenados, cierra el en curso y borra con lápida', async () => {
    const taurus = await setup()
    const afternoon = await taurus.repo.saveShift({ date: '2026-11-06', startTime: '14:00' })
    const morning = await taurus.repo.saveShift({ date: '2026-11-06', startTime: '06:00', endTime: '10:00', note: 'mañana' })
    await taurus.repo.saveShift({ date: '2026-11-05', startTime: '08:00', endTime: '12:00' })
    expect((await taurus.repo.listShifts('2026-11-06')).map(shift => shift.id)).toEqual([morning.id, afternoon.id])
    expect((await taurus.repo.listShifts('2026-11-06'))[1]!.endTime).toBeUndefined()
    await taurus.repo.saveShift({ ...afternoon, endTime: '18:00' })
    expect((await taurus.repo.listShifts('2026-11-06'))[1]!.endTime).toBe('18:00')
    await taurus.repo.deleteShift(morning.id)
    expect((await taurus.repo.listShifts('2026-11-06')).map(shift => shift.id)).toEqual([afternoon.id])
    const tombstone = (await taurus.snapshot()).shifts.find(shift => shift.id === morning.id)
    expect(tombstone?.deleted).toBe(true)
  })

  it('dayView incluye los turnos del día y deleteDay los borra', async () => {
    const taurus = await setup()
    await taurus.repo.saveShift({ date: '2026-11-06', startTime: '06:00', endTime: '10:00' })
    const day = await taurus.saveDay({ date: '2026-11-06', km: 10, services: [{ amount: 1000 }] })
    expect(day.shifts).toEqual([expect.objectContaining({ startTime: '06:00', endTime: '10:00' })])
    await taurus.repo.deleteDay('2026-11-06')
    expect(await taurus.repo.listShifts('2026-11-06')).toEqual([])
  })

  it('movimientos de fondo: guarda, lista (nuevo primero) y borra con lápida', async () => {
    const taurus = await setup()
    const transfer = await taurus.repo.saveFundMovement({ date: '2026-11-01', categoryId: 'cat-gasolina', type: 'transfer', amount: 50000, note: 'envío' })
    const spend = await taurus.repo.saveFundMovement({ date: '2026-11-05', categoryId: 'cat-gasolina', type: 'spend', amount: 20000 })
    expect(transfer.id).toBeTruthy()
    expect((await taurus.repo.listFundMovements()).map(movement => movement.id)).toEqual([spend.id, transfer.id])
    await taurus.repo.deleteFundMovement(transfer.id)
    expect((await taurus.repo.listFundMovements()).map(movement => movement.id)).toEqual([spend.id])
    const snapshot = await taurus.snapshot()
    expect(snapshot.fundMovements).toHaveLength(2)
    expect(snapshot.fundMovements.find(movement => movement.id === transfer.id)!.deleted).toBe(true)
  })

  it('movimientos de caja conservan categoryId, cuenta y destino del traslado; el destino solo viaja en tipos que lo piden', async () => {
    const taurus = await setup()
    await taurus.repo.putCash({ date: '2026-11-07', opening: 0, openedAt: '2026-11-07T07:00:00', movements: [
      { id: '', type: 'expense', amount: 8000, categoryId: 'comida', accountId: 'transferencias', toAccountId: 'deposito' },
      { id: '', type: 'traslado', amount: 3000, accountId: 'caja', toAccountId: 'deposito' },
    ] })
    const cash = await taurus.repo.getCash('2026-11-07')
    expect(cash!.movements.map(movement => [movement.categoryId, movement.accountId, movement.toAccountId])).toEqual([['comida', 'transferencias', undefined], [undefined, 'caja', 'deposito']])
    const stored = (await taurus.snapshot()).movements
    expect(stored.every(record => !('method' in record))).toBe(true)
  })

  it('un movimiento viejo con medio y sin cuenta se ve con la cuenta de su medio de pago', async () => {
    const store = createMemoryStore()
    const taurus = createTaurus(store)
    await taurus.init()
    await store.save({
      cash: [{ id: '2026-11-08', date: '2026-11-08', opening: 0, openedAt: 'x', updatedAt: 'x' }],
      movements: [{ id: 'm1', date: '2026-11-08', type: 'expense', amount: 5, method: 'transfer', updatedAt: 'x' }, { id: 'm2', date: '2026-11-08', type: 'expense', amount: 6, updatedAt: 'x' }],
    })
    const second = createTaurus(store)
    expect((await second.repo.getCash('2026-11-08'))!.movements.map(movement => movement.accountId)).toEqual(['transferencias', 'caja'])
    expect((await second.repo.listMovements()).map(movement => movement.accountId).sort()).toEqual(['caja', 'transferencias'])
  })

  it('getRates devuelve las tasas por defecto y saveRates las guarda', async () => {
    const taurus = await setup()
    expect(await taurus.repo.getRates()).toEqual({ commissionRate: 0.095, vatRate: 0.19 })
    await taurus.repo.saveRates({ commissionRate: 0.1, vatRate: 0.2 })
    expect(await taurus.repo.getRates()).toEqual({ commissionRate: 0.1, vatRate: 0.2 })
    expect((await taurus.snapshot()).settings[0]).toMatchObject({ id: 'rates', commissionRate: 0.1, vatRate: 0.2 })
  })

  it('conserva isIndrive y comisión por viaje y descuenta del neto del día', async () => {
    const taurus = await setup()
    const day = await taurus.saveDay({
      date: '2026-10-14', km: 0,
      services: [{ amount: 9000, isIndrive: true, commission: 855, commissionVat: 162.45 }, { amount: 5000, isIndrive: false, commission: 0, commissionVat: 0 }],
    })
    expect(day.commission).toBe(855)
    expect(day.commissionVat).toBe(162.45)
    expect(day.net).toBeCloseTo(14000 - 855 - 162.45, 6)
    const own = day.services.find(service => service.amount === 5000)!
    expect(own.isIndrive).toBe(false)
    expect(own.commission).toBe(0)
  })

  it('cambiar las tasas no reescribe viajes ya guardados', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-10-14', km: 0, services: [{ amount: 9000, isIndrive: true, commission: 855, commissionVat: 162.45 }] })
    await taurus.repo.saveRates({ commissionRate: 0.2, vatRate: 0.19 })
    expect((await taurus.repo.getDay('2026-10-14'))!.commission).toBe(855)
  })

  it('plantillas de turno: guarda, lista solo activas ordenadas, edita y borra con lápida', async () => {
    const taurus = await setup()
    const noon = await taurus.repo.saveShiftTemplate({ name: 'Mediodía', startTime: '12:00', endTime: '14:00' })
    const night = await taurus.repo.saveShiftTemplate({ name: 'Noche', startTime: '19:00', endTime: '23:00', sortOrder: 5 })
    const early = await taurus.repo.saveShiftTemplate({ name: 'Madrugada', startTime: '05:00', endTime: '08:00', active: false })
    expect(noon.id).toBeTruthy()
    expect((await taurus.repo.listShiftTemplates()).map(template => template.name)).toEqual(['Mediodía', 'Noche'])
    expect((await taurus.repo.listShiftTemplates({ includeInactive: true })).map(template => template.name)).toEqual(['Mediodía', 'Noche', 'Madrugada'])
    await taurus.repo.saveShiftTemplate({ ...early, active: true, sortOrder: -1 })
    expect((await taurus.repo.listShiftTemplates()).map(template => template.name)).toEqual(['Madrugada', 'Mediodía', 'Noche'])
    await taurus.repo.deleteShiftTemplate(night.id)
    expect((await taurus.repo.listShiftTemplates()).map(template => template.name)).toEqual(['Madrugada', 'Mediodía'])
    expect((await taurus.snapshot()).shiftTemplates.find(template => template.id === night.id)?.deleted).toBe(true)
  })

  it('el turno conserva templateId y desmarcar la plantilla deja lápida solo a ese turno', async () => {
    const taurus = await setup()
    const template = await taurus.repo.saveShiftTemplate({ name: 'Mediodía', startTime: '12:00', endTime: '14:00' })
    const fromTemplate = await taurus.repo.saveShift({ date: '2026-11-07', startTime: '12:00', endTime: '14:00', templateId: template.id })
    const loose = await taurus.repo.saveShift({ date: '2026-11-07', startTime: '16:00', endTime: '17:00' })
    expect(fromTemplate.templateId).toBe(template.id)
    expect(loose.templateId).toBeUndefined()
    const adjusted = await taurus.repo.saveShift({ ...fromTemplate, startTime: '12:30' })
    expect(adjusted.templateId).toBe(template.id)
    await taurus.repo.deleteShift(adjusted.id)
    expect((await taurus.repo.listShifts('2026-11-07')).map(shift => shift.id)).toEqual([loose.id])
  })

  it('un almacén local sin catálogos los siembra; uno con catálogos no se toca', async () => {
    const taurus = await setup()
    const catalogs = await taurus.repo.listCatalogs()
    expect(catalogs.paymentMethods.map(method => method.id)).toEqual(['cash', 'transfer'])
    expect(catalogs.movementTypes.map(type => [type.id, type.sign])).toEqual([['expense', -1], ['withdrawal', -1], ['deposit', 1], ['traslado', -1]])
    expect(catalogs.accounts.map(account => account.id)).toEqual(['caja', 'transferencias', 'deposito'])
    expect(catalogs.fundMovementTypes.map(type => type.id)).toEqual(['transfer', 'spend'])
    expect(catalogs.expenseCategories.map(category => category.id)).toEqual(['comida', 'parqueadero', 'varios'])
    const store = createMemoryStore()
    await store.save({ paymentMethods: [{ id: 'nequi', name: 'Nequi', accountId: 'transferencias', affectsCash: false, sortOrder: 0, active: true, updatedAt: 'x' }] })
    const other = createTaurus(store)
    await other.init()
    expect((await other.repo.listCatalogs()).paymentMethods.map(method => method.id)).toEqual(['nequi'])
  })

  it('crea una entrada de catálogo con código a partir del nombre y la ordena al final', async () => {
    const taurus = await setup()
    const created = await taurus.repo.saveCatalogEntry('expenseCategories', { name: 'Peaje Norte' })
    expect(created).toEqual({ id: 'peaje-norte', name: 'Peaje Norte', sortOrder: 3, active: true })
    expect((await taurus.repo.listCatalogs()).expenseCategories.map(category => category.id)).toEqual(['comida', 'parqueadero', 'varios', 'peaje-norte'])
    const method = await taurus.repo.saveCatalogEntry('paymentMethods', { name: 'Nequi', accountId: 'transferencias', affectsCash: true })
    expect(method).toMatchObject({ id: 'nequi', accountId: 'transferencias', affectsCash: false, active: true }) // affectsCash sale de la cuenta
    await expect(taurus.repo.saveCatalogEntry('paymentMethods', { name: 'Sin cuenta', accountId: 'nope', affectsCash: false })).rejects.toThrow(ApiError)
    const account = await taurus.repo.saveCatalogEntry('accounts', { name: 'Ahorros', initialBalance: 5000, isCashBox: false })
    expect(account).toMatchObject({ id: 'ahorros', initialBalance: 5000, isCashBox: false, sortOrder: 3 })
    await expect(taurus.repo.saveCatalogEntry('expenseCategories', { name: 'comida' })).rejects.toThrow(ApiError)
    await expect(taurus.repo.saveCatalogEntry('expenseCategories', { name: '---' })).rejects.toThrow(ApiError)
  })

  it('edita una entrada (nombre, orden, activo) conservando su código', async () => {
    const taurus = await setup()
    const [first] = (await taurus.repo.listCatalogs()).movementTypes
    const edited = await taurus.repo.saveCatalogEntry('movementTypes', { ...first!, name: 'Gasto de ruta', active: false })
    expect(edited).toMatchObject({ id: first!.id, name: 'Gasto de ruta', active: false, sign: first!.sign })
  })

  it('no permite borrar un código en uso; sin uso deja lápida y puede recrearse', async () => {
    const taurus = await setup()
    await taurus.saveDay({ date: '2026-11-07', km: 0, services: [{ amount: 5000, method: 'transfer' }] })
    await expect(taurus.repo.deleteCatalogEntry('paymentMethods', 'transfer')).rejects.toThrow(/en uso/)
    await taurus.repo.deleteCatalogEntry('expenseCategories', 'varios')
    expect((await taurus.repo.listCatalogs()).expenseCategories.map(category => category.id)).toEqual(['comida', 'parqueadero'])
    expect((await taurus.snapshot()).expenseCategories.find(category => category.id === 'varios')?.deleted).toBe(true)
    const again = await taurus.repo.saveCatalogEntry('expenseCategories', { name: 'Varios' })
    expect(again.id).toBe('varios')
    expect((await taurus.repo.listCatalogs()).expenseCategories.map(category => category.id)).toContain('varios')
  })
})

describe('modos de tarifa en catálogo', () => {
  it('siembra direct y derived en un almacén nuevo', async () => {
    const taurus = await setup()
    const { rateModes } = await taurus.repo.listCatalogs()
    expect(rateModes.map(mode => [mode.id, mode.usesRatePerKm, mode.usesCostInterval])).toEqual([['direct', true, false], ['derived', false, true]])
  })

  it('un modo nuevo de valor por km calcula el costo del día (seguro 18 $/km)', async () => {
    const taurus = await setup()
    await taurus.repo.saveCatalogEntry('rateModes', { name: 'Fijo por km', usesRatePerKm: true, usesCostInterval: false })
    await taurus.repo.saveCategory({ name: 'Seguro', rateMode: 'fijo-por-km', ratePerKm: 18, active: true })
    const day = await taurus.saveDay({ date: '2026-11-10', km: 100, services: [{ amount: 100000 }] })
    expect(day.costs.find(cost => cost.name === 'Seguro')!.amount).toBe(1800)
  })

  it('un modo en uso por una categoría no se puede borrar', async () => {
    const taurus = await setup()
    await expect(taurus.repo.deleteCatalogEntry('rateModes', 'direct')).rejects.toThrow(ApiError)
  })

  it('el PUT de una categoría incluye el modo que usa', async () => {
    const saved: Record<string, unknown>[] = []
    const memory = createMemoryStore()
    const taurus = createTaurus({ load: () => memory.load(), save: async changes => { saved.push(changes); await memory.save(changes) } })
    await taurus.init()
    saved.length = 0
    await taurus.repo.saveCategory({ name: 'Peaje', rateMode: 'direct', ratePerKm: 5, active: true })
    expect(Object.keys(saved[0]!).sort()).toEqual(['categories', 'rateModes'])
    expect((saved[0]!.rateModes as { id: string }[]).map(mode => mode.id)).toEqual(['direct'])
  })
})
