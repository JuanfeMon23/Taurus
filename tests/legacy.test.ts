import { describe, it, expect } from 'vitest'
import { fromLegacy } from '../app/services/legacy'
import { createMemoryStore } from '../app/services/memoryStore'
import { createTaurus } from '../app/services/taurus'

const old = {
  categories: [
    { id: 1, name: 'Gasolina', rateMode: 'direct', ratePerKm: 100, active: true },
    { id: 2, name: 'Servicio moto', rateMode: 'derived', totalCost: 160000, intervalKm: 3500, active: true },
    { id: 3, name: 'Seguro', rateMode: 'direct', ratePerKm: 10, active: false },
  ],
  days: {
    '2026-10-15': {
      date: '2026-10-15', km: 80, services: [{ amount: 150000 }, { amount: 20000, method: 'transfer' }],
      costs: [{ categoryId: 1, name: 'Gasolina', rate: 100, amount: 8000 }, { categoryId: 3, name: 'Seguro', rate: 10, amount: 800 }],
      gross: 170000, totalCost: 8800, net: 161200,
    },
  },
  nextCategoryId: 4,
  cash: { '2026-10-15': { date: '2026-10-15', opening: 50000, openedAt: '2026-10-15T12:00:00Z', movements: [{ id: 1, type: 'expense', amount: 8000 }] } },
}

describe('migración del formato anterior', () => {
  it('convierte ids numéricos y asigna ids únicos', () => {
    const s = fromLegacy(old)
    expect(s.categories.map(c => c.id)).toEqual(['cat-gasolina', 'cat-servicio-moto', 'cat-legacy-3'])
    expect(s.days[0]!.costs.map(c => c.categoryId)).toEqual(['cat-gasolina', 'cat-legacy-3'])
    expect(s.services).toHaveLength(2)
    expect(s.services[0]!.method).toBe('cash')
    expect(new Set(s.services.map(x => x.id)).size).toBe(2)
    expect(s.movements[0]!.id).not.toBe('1')
    expect(s.cash[0]!.id).toBe('2026-10-15')
  })

  it('el almacén en localStorage migra solo y conserva los datos', async () => {
    const mem = new Map<string, string>([['taurus-state', JSON.stringify(old)]])
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    const t = createTaurus(createMemoryStore(storage))
    await t.init()
    const d = (await t.repo.getDay('2026-10-15'))!
    expect(d.gross).toBe(170000)
    expect(d.net).toBe(161200)
    expect((await t.repo.getCash('2026-10-15'))!.movements[0]!.amount).toBe(8000)
    expect(await t.repo.listCategories()).toHaveLength(3)
    expect(JSON.parse(mem.get('taurus-state')!).version).toBe(2)
  })
})
