import { describe, it, expect } from 'vitest'
import { accountBalance, accountBalances, LOW_COMMISSION_BALANCE, needsRecharge, movementDirection, type AccountsData } from '../app/utils/accounts'
import { movementAccountId, movementTypeHasCategory } from '../app/utils/catalogs'
import type { CashDay, DatedMovement, DayRecord } from '../app/services/types'
import { testCatalogs } from './fixtures/catalogs'

const catalogs = testCatalogs()

const cash = (date: string, overrides: Partial<CashDay> = {}): CashDay => ({
  date, opening: 50000, openedAt: `${date}T07:00:00`, movements: [], ...overrides,
})
const day = (date: string, services: DayRecord['services']): DayRecord => ({
  date, km: 0, services, costs: [], gross: 0, totalCost: 0, net: 0,
})
const movement = (id: string, overrides: Partial<DatedMovement>): DatedMovement => ({
  id, date: '2026-11-03', type: 'withdrawal', amount: 1000, accountId: 'caja', ...overrides,
})
/** Datos de cuentas: los movimientos planos salen de las cajas, más los que se pasen aparte (fechas sin caja). */
const dataOf = (parts: { cashes?: CashDay[]; days?: DayRecord[]; movements?: DatedMovement[] }): AccountsData => {
  const cashes = parts.cashes ?? []
  return {
    ...catalogs, cashes, days: parts.days ?? [],
    movements: [...cashes.flatMap(cashDay => cashDay.movements.map(entry => ({ ...entry, date: cashDay.date }))), ...(parts.movements ?? [])],
  }
}

describe('accountBalance: depósito', () => {
  it('es Σ lo depositado en las cajas − las salidas (el resultado que daba depositBalance)', () => {
    const cashes = [cash('2026-11-01', { toDeposit: 50000 }), cash('2026-11-02'), cash('2026-11-03', { toDeposit: 20000 })]
    const outflows = [
      movement('a', { amount: 15000, accountId: 'deposito' }),
      movement('b', { amount: 5000, accountId: 'deposito', date: '2026-11-09' }), // fecha sin caja
    ]
    expect(accountBalance('deposito', dataOf({ cashes, movements: outflows }))).toBe(50000)
  })
  it('sin datos es 0 y suma el saldo inicial', () => {
    expect(accountBalance('deposito', dataOf({}))).toBe(0)
    const withInitial = { ...dataOf({}), accounts: catalogs.accounts.map(account => (account.id === 'deposito' ? { ...account, initialBalance: 12000 } : account)) }
    expect(accountBalance('deposito', withInitial)).toBe(12000)
  })
  it('un traslado de la caja al depósito suma al depósito', () => {
    const cashes = [cash('2026-11-03', { toDeposit: 10000, movements: [{ id: 't', type: 'traslado', amount: 4000, accountId: 'caja', toAccountId: 'deposito' }] })]
    expect(accountBalance('deposito', dataOf({ cashes }))).toBe(14000)
  })
})

describe('accountBalance: cuentas fuera de la caja', () => {
  it('transferencias = saldo inicial + viajes cobrados por transferencia (con bonus) + movimientos según su signo', () => {
    const data = dataOf({
      days: [day('2026-11-03', [{ amount: 20000, bonus: 3000, method: 'transfer' }, { amount: 9000, method: 'cash' }, { amount: 5000 }])],
      movements: [
        movement('gasto', { type: 'expense', amount: 4000, accountId: 'transferencias' }),
        movement('aporte', { type: 'deposit', amount: 1500, accountId: 'transferencias' }),
        movement('en-caja', { type: 'expense', amount: 700, accountId: 'caja' }),
      ],
    })
    data.accounts = data.accounts.map(account => (account.id === 'transferencias' ? { ...account, initialBalance: 10000 } : account))
    expect(accountBalance('transferencias', data)).toBe(10000 + 23000 - 4000 + 1500)
  })
  it('un traslado resta al origen y suma al destino por el mismo monto', () => {
    const data = dataOf({ movements: [movement('t', { type: 'traslado', amount: 8000, accountId: 'transferencias', toAccountId: 'deposito' })] })
    expect(accountBalance('transferencias', data)).toBe(-8000)
    expect(accountBalance('deposito', data)).toBe(8000)
  })
  it('un traslado sin destino no suma a ninguna cuenta; un destino en un tipo sin destino se ignora', () => {
    const data = dataOf({ movements: [
      movement('a', { type: 'traslado', amount: 100, accountId: 'transferencias' }),
      movement('b', { type: 'withdrawal', amount: 50, accountId: 'transferencias', toAccountId: 'deposito' }),
    ] })
    expect(accountBalance('deposito', data)).toBe(0)
    expect(accountBalance('transferencias', data)).toBe(-150)
  })
  it('una cuenta desconocida vale 0', () => {
    expect(accountBalance('nope', dataOf({}))).toBe(0)
  })
})

describe('accountBalance: caja', () => {
  it('sin cajas es el saldo inicial', () => {
    const data = dataOf({})
    data.accounts = data.accounts.map(account => (account.isCashBox ? { ...account, initialBalance: 7000 } : account))
    expect(accountBalance('caja', data)).toBe(7000)
  })
  it('con la caja abierta es el efectivo esperado, con movimientos de la caja y traslados que entran y salen', () => {
    const cashes = [cash('2026-11-03', { movements: [
      { id: 'g', type: 'expense', amount: 8000, accountId: 'caja' },
      { id: 'otra', type: 'expense', amount: 999, accountId: 'transferencias' },
      { id: 'sale', type: 'traslado', amount: 5000, accountId: 'caja', toAccountId: 'deposito' },
      { id: 'entra', type: 'traslado', amount: 3000, accountId: 'transferencias', toAccountId: 'caja' },
    ] })]
    const data = dataOf({ cashes, days: [day('2026-11-03', [{ amount: 40000 }, { amount: 20000, method: 'transfer' }])] })
    expect(accountBalance('caja', data)).toBe(50000 + 40000 - 8000 - 5000 + 3000)
  })
  it('con la última caja cerrada es lo que queda en caja (contado − depósito)', () => {
    const cashes = [cash('2026-11-02', { closedAt: 'x', counted: 90000, toDeposit: 40000 }), cash('2026-11-01', { closedAt: 'x', counted: 1, toDeposit: 1 })]
    expect(accountBalance('caja', dataOf({ cashes }))).toBe(50000)
  })
  it('manda la caja más reciente', () => {
    const cashes = [cash('2026-11-02', { closedAt: 'x', counted: 90000, toDeposit: 40000 }), cash('2026-11-03', { opening: 50000 })]
    expect(accountBalance('caja', dataOf({ cashes }))).toBe(50000)
  })
})

describe('accountBalance: cuenta de comisión (Saldo inDrive)', () => {
  const indriveTrip = (amount: number, overrides: Record<string, unknown> = {}) => ({ amount, isIndrive: true, commission: amount * 0.1, commissionVat: amount * 0.1 * 0.19, ...overrides })
  const recharge = (id: string, amount: number, fromAccountId: string, date = '2026-11-12') =>
    movement(id, { type: 'traslado', amount, accountId: fromAccountId, toAccountId: 'indrive', date })

  it('la recarga (traslado desde Nequi o Bancolombia) suma al saldo inDrive y resta al origen', () => {
    const data = dataOf({ movements: [recharge('a', 50000, 'transferencias'), recharge('b', 20000, 'bancolombia')] })
    expect(accountBalance('indrive', data)).toBe(70000)
    expect(accountBalance('transferencias', data)).toBe(-50000)
    expect(accountBalance('bancolombia', data)).toBe(-20000)
  })
  it('la comisión + IVA de los viajes inDrive desde commissionSince resta del saldo', () => {
    const data = dataOf({
      movements: [recharge('a', 50000, 'transferencias')],
      days: [day('2026-11-12', [indriveTrip(10000), indriveTrip(20000, { method: 'transfer' })])],
    })
    expect(accountBalance('indrive', data)).toBeCloseTo(50000 - (1000 + 190) - (2000 + 380), 6)
  })
  it('los viajes anteriores a commissionSince y los que no son inDrive no restan', () => {
    const data = dataOf({
      movements: [recharge('a', 50000, 'transferencias')],
      days: [
        day('2026-11-11', [indriveTrip(10000)]),
        day('2026-11-12', [{ amount: 8000, isIndrive: false, commission: 0, commissionVat: 0 }, indriveTrip(10000)]),
      ],
    })
    expect(accountBalance('indrive', data)).toBeCloseTo(50000 - (1000 + 190), 6)
  })
  it('el viaje inDrive no suma su monto a ninguna cuenta por el saldo inDrive (solo resta su comisión)', () => {
    const data = dataOf({ days: [day('2026-11-12', [indriveTrip(10000, { method: 'cash' })])] })
    expect(accountBalance('indrive', data)).toBeCloseTo(-1190, 6)
  })
  it('suma el saldo inicial y el saldo puede quedar negativo', () => {
    const data = dataOf({ days: [day('2026-11-13', [indriveTrip(100000)])] })
    data.accounts = data.accounts.map(account => (account.id === 'indrive' ? { ...account, initialBalance: 5000 } : account))
    expect(accountBalance('indrive', data)).toBeCloseTo(5000 - 11900, 6)
  })
  it('las demás cuentas no descuentan la comisión', () => {
    const data = dataOf({ days: [day('2026-11-12', [indriveTrip(10000, { method: 'transfer' })])] })
    expect(accountBalance('transferencias', data)).toBe(10000)
    expect(accountBalance('bancolombia', data)).toBe(0)
  })
  it('la recarga no es un gasto: el tipo traslado no lleva categoría', () => {
    expect(movementTypeHasCategory(catalogs.movementTypes, 'traslado')).toBe(false)
    expect(movementTypeHasCategory(catalogs.movementTypes, 'expense')).toBe(true)
  })
})

describe('needsRecharge', () => {
  const { accounts } = catalogs
  const indrive = accounts.find(account => account.id === 'indrive')!
  it('la cuenta de comisión pide recarga con saldo negativo o bajo; con saldo suficiente no', () => {
    expect(needsRecharge(indrive, -1)).toBe(true)
    expect(needsRecharge(indrive, LOW_COMMISSION_BALANCE)).toBe(true)
    expect(needsRecharge(indrive, LOW_COMMISSION_BALANCE + 1)).toBe(false)
  })
  it('una cuenta corriente nunca pide recarga, aunque quede en rojo', () => {
    expect(needsRecharge(accounts.find(account => account.id === 'bancolombia')!, -500)).toBe(false)
  })
})

describe('accountBalances', () => {
  it('lista las cuentas activas en orden con su saldo', () => {
    const data = dataOf({})
    data.accounts = [...data.accounts, { id: 'vieja', name: 'Vieja', initialBalance: 5, isCashBox: false, sortOrder: 9, active: false }]
    expect(accountBalances(data).map(entry => [entry.account.id, entry.balance])).toEqual([['caja', 0], ['transferencias', 0], ['deposito', 0], ['bancolombia', 0], ['indrive', 0]])
  })
})

describe('movementAccountId: datos viejos', () => {
  it('usa la cuenta del movimiento; sin ella, la de su medio de pago; sin medio, la del medio por defecto; desconocido, la caja', () => {
    expect(movementAccountId({ accountId: 'deposito' }, catalogs)).toBe('deposito')
    expect(movementAccountId({ method: 'transfer' }, catalogs)).toBe('transferencias')
    expect(movementAccountId({}, catalogs)).toBe('caja')
    expect(movementAccountId({ method: 'nequi' }, catalogs)).toBe('caja')
  })
})

describe('movementDirection', () => {
  const { movementTypes } = catalogs
  it('un traslado visto desde su destino suma; desde su origen resta; desde otra cuenta no cuenta', () => {
    const transfer = { type: 'traslado', accountId: 'transferencias', toAccountId: 'caja' }
    expect(movementDirection(transfer, 'caja', movementTypes)).toBe(1)
    expect(movementDirection(transfer, 'transferencias', movementTypes)).toBe(-1)
    expect(movementDirection(transfer, 'deposito', movementTypes)).toBe(0)
  })
  it('un movimiento corriente usa el signo de su tipo en su cuenta', () => {
    expect(movementDirection({ type: 'expense', accountId: 'caja' }, 'caja', movementTypes)).toBe(-1)
    expect(movementDirection({ type: 'deposit', accountId: 'caja' }, 'caja', movementTypes)).toBe(1)
    expect(movementDirection({ type: 'deposit', accountId: 'caja', toAccountId: 'deposito' }, 'deposito', movementTypes)).toBe(0)
  })
})
