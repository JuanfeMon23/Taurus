import { describe, it, expect } from 'vitest'
import { closingBase, keptInCash, suggestedOpening, validateClosing } from '../app/utils/cash'
import { accountBalance } from '../app/utils/accounts'
import type { CashDay, DatedMovement, DayRecord } from '../app/services/types'
import { testCatalogs } from './fixtures/catalogs'

const catalogs = testCatalogs()

const cash = (date: string, overrides: Partial<CashDay> = {}): CashDay => ({
  date, opening: 50000, openedAt: `${date}T07:00:00`, movements: [], ...overrides,
})
const day = (date: string, amounts: number[]): DayRecord => ({
  date, km: 0, services: amounts.map(amount => ({ amount })), costs: [], gross: 0, totalCost: 0, net: 0,
})
const buildOutflow = (id: string, amount: number): DatedMovement => ({ id, date: '2026-11-03', type: 'withdrawal', amount, accountId: 'deposito' })
const depositBalance = (cashes: CashDay[], outflows: DatedMovement[]) => accountBalance('deposito', { ...catalogs, cashes, days: [], movements: outflows })

describe('depósito: queda en caja', () => {
  it('base = contado si hay conteo; si no, el esperado', () => {
    expect(closingBase(120000, 90000)).toBe(90000)
    expect(closingBase(120000, undefined)).toBe(120000)
  })
  it('queda en caja = base − depósito (sin depósito = base)', () => {
    expect(keptInCash(100000, 30000)).toBe(70000)
    expect(keptInCash(100000, undefined)).toBe(100000)
  })
})

describe('depósito: validación del cierre', () => {
  it('acepta depósito igual o menor a la base', () => {
    expect(validateClosing({ expected: 100000, counted: 80000, toDeposit: 80000 })).toBeNull()
    expect(validateClosing({ expected: 100000, toDeposit: 100000 })).toBeNull()
    expect(validateClosing({ expected: 100000 })).toBeNull()
  })
  it('rechaza depósito mayor al contado', () => {
    expect(validateClosing({ expected: 100000, counted: 80000, toDeposit: 80001 })).toMatch(/contado/)
  })
  it('sin conteo, rechaza depósito mayor al esperado', () => {
    expect(validateClosing({ expected: 100000, toDeposit: 100001 })).toMatch(/esperado/)
  })
  it('rechaza negativos', () => {
    expect(validateClosing({ expected: 100000, toDeposit: -1 })).toMatch(/negativ/)
    expect(validateClosing({ expected: 100000, counted: -5 })).toMatch(/negativ/)
  })
})

describe('depósito: saldo (cuenta deposito)', () => {
  it('suma lo depositado en las cajas y resta las salidas', () => {
    const cashes = [cash('2026-11-01', { toDeposit: 50000 }), cash('2026-11-02'), cash('2026-11-03', { toDeposit: 20000 })]
    expect(depositBalance(cashes, [buildOutflow('a', 15000), buildOutflow('b', 5000)])).toBe(50000)
  })
  it('sin datos es 0', () => {
    expect(depositBalance([], [])).toBe(0)
  })
})

describe('apertura sugerida', () => {
  it('es lo que quedó en el cierre más reciente anterior (contado − depósito)', () => {
    const cashes = [
      cash('2026-11-01', { closedAt: 'x', counted: 90000, toDeposit: 40000 }),
      cash('2026-11-02', { closedAt: 'x', counted: 120000, toDeposit: 70000 }),
    ]
    expect(suggestedOpening(cashes, [], '2026-11-04', catalogs)).toBe(50000)
  })
  it('sin conteo usa el esperado como base', () => {
    const cashes = [cash('2026-11-02', { opening: 50000, closedAt: 'x', toDeposit: 30000 })]
    expect(suggestedOpening(cashes, [day('2026-11-02', [40000])], '2026-11-03', catalogs)).toBe(60000)
  })
  it('ignora cajas abiertas, de la misma fecha o posteriores', () => {
    const cashes = [
      cash('2026-11-02', { closedAt: 'x', counted: 70000 }),
      cash('2026-11-03', { counted: 99999 }),
      cash('2026-11-04', { closedAt: 'x', counted: 88888 }),
    ]
    expect(suggestedOpening(cashes, [], '2026-11-04', catalogs)).toBe(70000)
  })
  it('sin cierres previos no sugiere nada', () => {
    expect(suggestedOpening([], [], '2026-11-04', catalogs)).toBeUndefined()
  })
})
