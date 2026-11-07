import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'
import { mergeSnapshots } from '../app/services/merge'

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

describe('taurus: depósito', () => {
  it('guarda toDeposit en la caja y lo lee de vuelta', async () => {
    const taurus = await setup()
    await taurus.repo.putCash({ date: '2026-11-03', opening: 1000, openedAt: 'x', movements: [], closedAt: 'y', counted: 5000, toDeposit: 3000 })
    expect((await taurus.repo.getCash('2026-11-03'))?.toDeposit).toBe(3000)
    await taurus.repo.putCash({ date: '2026-11-03', opening: 1000, openedAt: 'x', movements: [] })
    expect((await taurus.repo.getCash('2026-11-03'))?.toDeposit).toBeUndefined()
  })

  it('registra salidas del depósito y las elimina con lápida', async () => {
    const taurus = await setup()
    const deposit = await taurus.repo.saveDepositMovement({ date: '2026-11-03', amount: 20000, note: 'banco' })
    expect(deposit.id).toBeTruthy()
    expect(await taurus.repo.listDepositMovements()).toEqual([{ id: deposit.id, date: '2026-11-03', amount: 20000, note: 'banco' }])
    await taurus.repo.deleteDepositMovement(deposit.id)
    expect(await taurus.repo.listDepositMovements()).toEqual([])
    const snapshot = await taurus.snapshot()
    expect(snapshot.depositMovements).toHaveLength(1)
    expect(snapshot.depositMovements[0]!.deleted).toBe(true)
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
})
