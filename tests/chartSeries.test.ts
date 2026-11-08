import { describe, it, expect } from 'vitest'
import { aggregate } from '../app/utils/stats'
import { buildActivityRows, buildCostSeries, buildIncomeSeries, computeVisibleRange, formatClock } from '../app/utils/chartSeries'
import { moneyCompact } from '../app/utils/format'
import type { DayRecord } from '../app/services/types'
import { testCatalogs } from './fixtures/catalogs'

const buildDay = (date: string, services: DayRecord['services'], costs: [string, string, number][] = []): DayRecord => {
  const lines = costs.map(([categoryId, name, amount]) => ({ categoryId, name, rate: 0, amount }))
  return { date, km: 10, services, costs: lines, gross: 0, totalCost: 0, commission: 0, commissionVat: 0, net: 0 }
}

describe('formatClock', () => {
  it('da HH:MM y vuelve a 00:00 pasada la medianoche', () => {
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(1440 + 20)).toBe('00:20')
  })
})

describe('buildActivityRows', () => {
  const days = [
    buildDay('2026-10-02', [{ id: 'c', amount: 8000, startTime: '09:00', endTime: '09:30' }]),
    buildDay('2026-10-01', [
      { id: 'b', amount: 5000, bonus: 1000, startTime: '10:00', endTime: '10:30' },
      { id: 'a', amount: 7000, startTime: '08:00', endTime: '09:00' },
    ]),
    buildDay('2026-10-03', [{ id: 'x', amount: 3000 }]),
  ]

  it('omite días sin horarios y ordena cronológicamente', () => {
    expect(buildActivityRows(days, 'all').map(row => row.date)).toEqual(['2026-10-01', '2026-10-02'])
  })
  it('cada viaje trae horas, duración, monto con bonus y los huecos entre viajes', () => {
    const [first] = buildActivityRows(days, 'all')
    expect(first!.trips).toEqual([
      { tripId: 'a', startMinute: 480, endMinute: 540, minutes: 60, amount: 7000 },
      { tripId: 'b', startMinute: 600, endMinute: 630, minutes: 30, amount: 6000 },
    ])
    expect(first!.gaps).toEqual([{ startMinute: 540, endMinute: 600, minutes: 60 }])
  })
  it('modo latest deja solo el último día trabajado', () => {
    expect(buildActivityRows(days, 'latest').map(row => row.date)).toEqual(['2026-10-02'])
  })
  it('sin días trabajados devuelve vacío', () => {
    expect(buildActivityRows([], 'latest')).toEqual([])
  })
})

describe('buildActivityRows con turnos', () => {
  const shiftDay = {
    ...buildDay('2026-10-05', [
      { id: 'a', amount: 1000, startTime: '08:30', endTime: '09:00' },
      { id: 'o', amount: 2000, startTime: '12:00', endTime: '12:20' },
    ]),
    shifts: [{ startTime: '08:00', endTime: '10:00' }, { startTime: '04:30', endTime: '07:30' }],
  }
  it('trae bandas de turno, huecos solo en turno y viajes fuera de turno', () => {
    const [row] = buildActivityRows([shiftDay], 'all')
    expect(row!.hasShifts).toBe(true)
    expect(row!.shifts).toEqual([
      { startMinute: 270, endMinute: 450, minutes: 180 },
      { startMinute: 480, endMinute: 600, minutes: 120 },
    ])
    expect(row!.gaps).toEqual([
      { startMinute: 270, endMinute: 450, minutes: 180 },
      { startMinute: 480, endMinute: 510, minutes: 30 },
      { startMinute: 540, endMinute: 600, minutes: 60 },
    ])
    expect(row!.outOfShiftTripIds).toEqual(['o'])
  })
  it('un día solo con turnos aparece; sin turnos las bandas van vacías', () => {
    const onlyShift = { ...buildDay('2026-10-07', []), shifts: [{ startTime: '08:00', endTime: '09:00' }] }
    expect(buildActivityRows([buildDay('2026-10-06', []), onlyShift], 'all').map(row => row.date)).toEqual(['2026-10-07'])
    expect(buildActivityRows([buildDay('2026-10-08', [{ id: 'x', amount: 1, startTime: '08:00', endTime: '09:00' }])], 'all')[0]!.shifts).toEqual([])
  })
})

describe('computeVisibleRange', () => {
  it('min/max de turnos y viajes con 30 min de margen redondeado a la hora', () => {
    const rows = buildActivityRows([
      { ...buildDay('2026-10-05', [{ id: 'a', amount: 1, startTime: '05:10', endTime: '05:40' }, { id: 'o', amount: 1, startTime: '17:10', endTime: '17:20' }]), shifts: [{ startTime: '04:30', endTime: '17:00' }] },
    ], 'all')
    // inicio 04:30 - 30 = 04:00; fin 17:20 + 30 = 17:50 -> 18:00
    expect(computeVisibleRange(rows)).toEqual({ startMinute: 240, endMinute: 1080 })
  })
  it('sin filas devuelve el día completo', () => {
    expect(computeVisibleRange([])).toEqual({ startMinute: 0, endMinute: 1440 })
  })
})

describe('buildCostSeries', () => {
  it('une categorías de todos los periodos y añade comisión y gastos varios', () => {
    const buckets = aggregate([
      buildDay('2026-09-01', [], [['g', 'Gasolina', 100]]),
      buildDay('2026-10-01', [], [['g', 'Gasolina', 200], ['s', 'Seguro', 50]]),
    ], 'month', [{ date: '2026-10-05', amount: 30, method: 'cash' }])
    const result = buildCostSeries(buckets)
    expect(result.labels).toEqual(['2026-09', '2026-10'])
    expect(result.series).toEqual([
      { name: 'Gasolina', data: [100, 200] },
      { name: 'Seguro', data: [0, 50] },
      { name: 'Comisión inDrive + IVA', data: [0, 0] },
      { name: 'Gastos varios', data: [0, 30] },
    ])
  })
})

describe('buildIncomeSeries', () => {
  const { paymentMethods } = testCatalogs()
  const buckets = aggregate([
    buildDay('2026-09-01', [{ amount: 100, method: 'cash' }, { amount: 40, method: 'transfer' }]),
    buildDay('2026-10-01', [{ amount: 70, method: 'transfer' }, { amount: 5, method: 'nequi' }]),
  ], 'month')
  it('una serie por medio activo del catálogo (orden y nombre del catálogo) y las de códigos nuevos al final', () => {
    expect(buildIncomeSeries(buckets, paymentMethods)).toEqual([
      { id: 'cash', name: 'Efectivo', data: [100, 0] },
      { id: 'transfer', name: 'Transferencia', data: [40, 70] },
      { id: 'nequi', name: 'nequi', data: [0, 5] },
    ])
  })
  it('un medio inactivo sin ingresos no aparece; con ingresos sí', () => {
    const methods = paymentMethods.map(method => (method.id === 'transfer' ? { ...method, active: false } : method))
    expect(buildIncomeSeries(buckets, methods).map(series => series.id)).toEqual(['cash', 'transfer', 'nequi'])
    expect(buildIncomeSeries(buckets.slice(0, 1).map(bucket => ({ ...bucket, incomeByMethod: new Map([['cash', 1]]) })), methods).map(series => series.id)).toEqual(['cash'])
  })
})

describe('moneyCompact', () => {
  it('abrevia miles y millones con coma decimal', () => {
    expect(moneyCompact(850)).toBe('$ 850')
    expect(moneyCompact(300000)).toBe('$ 300 k')
    expect(moneyCompact(1500000)).toBe('$ 1,5 M')
    expect(moneyCompact(-2000)).toBe('-$ 2 k')
  })
})
