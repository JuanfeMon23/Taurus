import { describe, it, expect } from 'vitest'
import { mergeSnapshots } from '../app/services/merge'
import { emptySnapshot, type ServiceRec, type Snapshot } from '../app/services/types'

const svc = (id: string, updatedAt: string, over: Partial<ServiceRec> = {}): ServiceRec =>
  ({ id, updatedAt, date: '2026-10-15', amount: 1000, method: 'cash', ...over })
const snap = (services: ServiceRec[]): Snapshot => ({ ...emptySnapshot(), services })

describe('mergeSnapshots', () => {
  it('une registros que solo existen en un lado', () => {
    const r = mergeSnapshots(snap([svc('a', '2026-10-15T10:00:00Z')]), snap([svc('b', '2026-10-15T11:00:00Z')]))
    expect(r.merged.services.map(s => s.id).sort()).toEqual(['a', 'b'])
    expect(r.toLocal.services.map(s => s.id)).toEqual(['b'])
    expect(r.remoteChanged).toBe(true)
  })

  it('gana la edición más reciente', () => {
    const local = snap([svc('a', '2026-10-15T10:00:00Z', { amount: 1000 })])
    const remote = snap([svc('a', '2026-10-15T12:00:00Z', { amount: 5000 })])
    const r = mergeSnapshots(local, remote)
    expect(r.merged.services[0]!.amount).toBe(5000)
    expect(r.toLocal.services).toHaveLength(1)
    expect(r.remoteChanged).toBe(false)
  })

  it('una edición local más reciente se sube', () => {
    const local = snap([svc('a', '2026-10-15T13:00:00Z', { amount: 7000 })])
    const remote = snap([svc('a', '2026-10-15T12:00:00Z', { amount: 5000 })])
    const r = mergeSnapshots(local, remote)
    expect(r.merged.services[0]!.amount).toBe(7000)
    expect(r.toLocal.services).toHaveLength(0)
    expect(r.remoteChanged).toBe(true)
  })

  it('un borrado (lápida) más reciente se propaga', () => {
    const local = snap([svc('a', '2026-10-15T10:00:00Z')])
    const remote = snap([svc('a', '2026-10-15T11:00:00Z', { deleted: true })])
    const r = mergeSnapshots(local, remote)
    expect(r.merged.services[0]!.deleted).toBe(true)
    expect(r.toLocal.services[0]!.deleted).toBe(true)
  })

  it('en empate de fecha gana el borrado', () => {
    const t = '2026-10-15T10:00:00Z'
    const r = mergeSnapshots(snap([svc('a', t)]), snap([svc('a', t, { deleted: true })]))
    expect(r.merged.services[0]!.deleted).toBe(true)
  })

  it('sin diferencias no hay cambios en ningún lado', () => {
    const s = snap([svc('a', '2026-10-15T10:00:00Z')])
    const r = mergeSnapshots(s, structuredClone(s))
    expect(r.toLocal.services).toHaveLength(0)
    expect(r.remoteChanged).toBe(false)
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
    const r = mergeSnapshots(local, remote)
    expect(r.merged.days).toHaveLength(1)
    expect(r.merged.movements).toHaveLength(1)
    expect(r.merged.categories).toHaveLength(1)
    expect(r.toLocal.movements).toHaveLength(1)
    expect(r.remoteChanged).toBe(true)
  })
})
