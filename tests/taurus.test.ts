import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'
import { mergeSnapshots } from '../app/services/merge'

async function setup() {
  const t = createTaurus(createMemoryStore())
  await t.init()
  return t
}

describe('taurus (dominio)', () => {
  it('siembra Gasolina y Servicio una sola vez, con ids fijos', async () => {
    const t = await setup()
    await t.init()
    const cats = await t.repo.listCategories()
    expect(cats.map(c => [c.id, c.name])).toEqual([['cat-gasolina', 'Gasolina'], ['cat-servicio-moto', 'Servicio moto']])
  })

  it('guarda el día con costos y neto; cada servicio recibe un id único', async () => {
    const t = await setup()
    const d = await t.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 120000 }, { amount: 80000 }] })
    expect(d.gross).toBe(200000)
    expect(d.net).toBeCloseTo(185428.57, 1)
    const ids = d.services.map(s => s.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => typeof id === 'string' && id.length >= 16)).toBe(true)
  })

  it('cambiar una tarifa no altera días ya guardados', async () => {
    const t = await setup()
    await t.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    const [gas] = await t.repo.listCategories()
    await t.repo.saveCategory({ ...gas!, ratePerKm: 200 })
    expect((await t.repo.getDay('2026-10-14'))!.costs[0]!.amount).toBe(10000)
  })

  it('recalcDay aplica las tarifas actuales', async () => {
    const t = await setup()
    await t.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    const [gas] = await t.repo.listCategories()
    await t.repo.saveCategory({ ...gas!, ratePerKm: 200 })
    expect((await t.recalcDay('2026-10-14'))!.costs[0]!.amount).toBe(20000)
  })

  it('una categoría nueva solo afecta días posteriores', async () => {
    const t = await setup()
    await t.saveDay({ date: '2026-10-13', km: 100, services: [{ amount: 100000 }] })
    await t.repo.saveCategory({ name: 'Seguro', rateMode: 'direct', ratePerKm: 10, active: true })
    await t.saveDay({ date: '2026-10-14', km: 100, services: [{ amount: 100000 }] })
    expect((await t.repo.getDay('2026-10-13'))!.costs).toHaveLength(2)
    expect((await t.repo.getDay('2026-10-14'))!.costs).toHaveLength(3)
  })

  it('re-guardar conserva ids y deja lápida del servicio quitado', async () => {
    const t = await setup()
    const d = await t.saveDay({ date: '2026-10-14', km: 10, services: [{ amount: 1000 }, { amount: 2000 }] })
    const [keep] = d.services
    const again = await t.saveDay({ date: '2026-10-14', km: 10, services: [{ ...keep!, amount: 1500 }] })
    expect(again.services.map(s => s.id)).toEqual([keep!.id])
    expect(again.gross).toBe(1500)
    const snap = await t.snapshot()
    expect(snap.services.filter(s => s.deleted)).toHaveLength(1)
  })

  it('borrar un día lo oculta y deja lápidas', async () => {
    const t = await setup()
    await t.saveDay({ date: '2026-10-14', km: 10, services: [{ amount: 1000 }] })
    await t.repo.deleteDay('2026-10-14')
    expect(await t.repo.getDay('2026-10-14')).toBeNull()
    expect(await t.repo.listDays()).toHaveLength(0)
    const snap = await t.snapshot()
    expect(snap.days[0]!.deleted).toBe(true)
    expect(snap.services[0]!.deleted).toBe(true)
  })

  it('caja: movimientos con id único y lápida al quitarlos', async () => {
    const t = await setup()
    await t.repo.putCash({ date: '2026-10-14', opening: 50000, openedAt: 'x', movements: [
      { id: '', type: 'expense', amount: 8000 }, { id: '', type: 'deposit', amount: 1000 }] })
    const c = (await t.repo.getCash('2026-10-14'))!
    expect(new Set(c.movements.map(m => m.id)).size).toBe(2)
    await t.repo.putCash({ ...c, movements: [c.movements[0]!] })
    expect((await t.repo.getCash('2026-10-14'))!.movements).toHaveLength(1)
    expect((await t.snapshot()).movements.filter(m => m.deleted)).toHaveLength(1)
  })

  it('dos dispositivos: el registro del otro se agrega al fusionar', async () => {
    const phone = await setup()
    const desktop = await setup()
    await phone.saveDay({ date: '2026-10-14', km: 50, services: [{ amount: 30000 }] })
    await desktop.saveDay({ date: '2026-10-15', km: 40, services: [{ amount: 20000, method: 'transfer' }] })

    const m = mergeSnapshots(await phone.snapshot(), await desktop.snapshot())
    await phone.apply(m.toLocal)
    expect((await phone.repo.listDays()).map(d => d.date)).toEqual(['2026-10-15', '2026-10-14'])
    expect((await phone.repo.getDay('2026-10-15'))!.services[0]!.method).toBe('transfer')
    // Las categorías sembradas con id fijo no se duplican.
    expect(await phone.repo.listCategories()).toHaveLength(2)
  })
})
