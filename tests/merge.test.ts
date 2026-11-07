import { describe, it, expect } from 'vitest'
import { mergeSnapshots } from '../app/services/merge'
import { emptySnapshot, type ServiceRec, type Snapshot } from '../app/services/types'

const makeService = (id: string, updatedAt: string, over: Partial<ServiceRec> = {}): ServiceRec =>
  ({ id, updatedAt, date: '2026-10-15', amount: 1000, method: 'cash', ...over })
const makeSnapshot = (services: ServiceRec[]): Snapshot => ({ ...emptySnapshot(), services })

describe('mergeSnapshots', () => {
  it('une registros que solo existen en un lado', () => {
    const result = mergeSnapshots(makeSnapshot([makeService('a', '2026-10-15T10:00:00Z')]), makeSnapshot([makeService('b', '2026-10-15T11:00:00Z')]))
    expect(result.merged.services.map(service => service.id).sort()).toEqual(['a', 'b'])
    expect(result.toLocal.services.map(service => service.id)).toEqual(['b'])
    expect(result.remoteChanged).toBe(true)
  })

  it('gana la edición más reciente', () => {
    const local = makeSnapshot([makeService('a', '2026-10-15T10:00:00Z', { amount: 1000 })])
    const remote = makeSnapshot([makeService('a', '2026-10-15T12:00:00Z', { amount: 5000 })])
    const result = mergeSnapshots(local, remote)
    expect(result.merged.services[0]!.amount).toBe(5000)
    expect(result.toLocal.services).toHaveLength(1)
    expect(result.remoteChanged).toBe(false)
  })

  it('una edición local más reciente se sube', () => {
    const local = makeSnapshot([makeService('a', '2026-10-15T13:00:00Z', { amount: 7000 })])
    const remote = makeSnapshot([makeService('a', '2026-10-15T12:00:00Z', { amount: 5000 })])
    const result = mergeSnapshots(local, remote)
    expect(result.merged.services[0]!.amount).toBe(7000)
    expect(result.toLocal.services).toHaveLength(0)
    expect(result.remoteChanged).toBe(true)
  })

  it('un borrado (lápida) más reciente se propaga', () => {
    const local = makeSnapshot([makeService('a', '2026-10-15T10:00:00Z')])
    const remote = makeSnapshot([makeService('a', '2026-10-15T11:00:00Z', { deleted: true })])
    const result = mergeSnapshots(local, remote)
    expect(result.merged.services[0]!.deleted).toBe(true)
    expect(result.toLocal.services[0]!.deleted).toBe(true)
  })

  it('en empate de fecha gana el borrado', () => {
    const timestamp = '2026-10-15T10:00:00Z'
    const result = mergeSnapshots(makeSnapshot([makeService('a', timestamp)]), makeSnapshot([makeService('a', timestamp, { deleted: true })]))
    expect(result.merged.services[0]!.deleted).toBe(true)
  })

  it('sin diferencias no hay cambios en ningún lado', () => {
    const snapshot = makeSnapshot([makeService('a', '2026-10-15T10:00:00Z')])
    const result = mergeSnapshots(snapshot, structuredClone(snapshot))
    expect(result.toLocal.services).toHaveLength(0)
    expect(result.remoteChanged).toBe(false)
  })

  it('fusiona todas las colecciones', () => {
    const local: Snapshot = {
      ...emptySnapshot(),
      days: [{ id: '2026-10-15', date: '2026-10-15', km: 80, costs: [], updatedAt: '2026-10-15T10:00:00Z' }],
    }
    const remote: Snapshot = {
      ...emptySnapshot(),
      movements: [{ id: 'm1', date: '2026-10-15', type: 'expense', amount: 8000, updatedAt: '2026-10-15T10:00:00Z' }],
      categories: [{ id: 'c1', name: 'Seguro', rateMode: 'direct', ratePerKm: 10, active: true, updatedAt: '2026-10-15T10:00:00Z' }],
    }
    const result = mergeSnapshots(local, remote)
    expect(result.merged.days).toHaveLength(1)
    expect(result.merged.movements).toHaveLength(1)
    expect(result.merged.categories).toHaveLength(1)
    expect(result.toLocal.movements).toHaveLength(1)
    expect(result.remoteChanged).toBe(true)
  })
})
