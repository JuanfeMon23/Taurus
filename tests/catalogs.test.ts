import { describe, it, expect } from 'vitest'
import { activeEntries, catalogEntryInUse, defaultMethodId, entryName, methodAffectsCash, movementSign, slugifyCode, sortCatalog } from '../app/utils/catalogs'
import { emptySnapshot } from '../app/services/types'
import { testCatalogs } from './fixtures/catalogs'

describe('orden y filtro de catálogos', () => {
  it('ordena por sortOrder y luego por nombre', () => {
    const sorted = sortCatalog([
      { id: 'b', name: 'Beta', sortOrder: 1, active: true },
      { id: 'a2', name: 'Alfa', sortOrder: 0, active: true },
      { id: 'a1', name: 'Aaa', sortOrder: 0, active: true },
    ])
    expect(sorted.map(entry => entry.id)).toEqual(['a1', 'a2', 'b'])
  })
  it('activeEntries descarta inactivas y no muta la entrada', () => {
    const entries = [{ id: 'x', name: 'X', sortOrder: 1, active: false }, { id: 'y', name: 'Y', sortOrder: 0, active: true }]
    expect(activeEntries(entries).map(entry => entry.id)).toEqual(['y'])
    expect(entries[0]!.id).toBe('x')
  })
  it('entryName da el nombre o, si el código no está, el propio código', () => {
    const { paymentMethods } = testCatalogs()
    expect(entryName(paymentMethods, 'transfer')).toBe('Transferencia')
    expect(entryName(paymentMethods, 'nequi')).toBe('nequi')
    expect(entryName(paymentMethods, undefined, 'Sin categoría')).toBe('Sin categoría')
  })
})

describe('slugifyCode', () => {
  it('normaliza el nombre a un código estable', () => {
    expect(slugifyCode('  Parqueadero Público ')).toBe('parqueadero-publico')
    expect(slugifyCode('Comida / Café')).toBe('comida-cafe')
  })
  it('un nombre sin letras ni números da vacío', () => {
    expect(slugifyCode('---')).toBe('')
  })
})

describe('reglas con catálogo', () => {
  const { paymentMethods, movementTypes } = testCatalogs()
  it('affectsCash sale del medio de pago', () => {
    expect(methodAffectsCash(paymentMethods, 'cash')).toBe(true)
    expect(methodAffectsCash(paymentMethods, 'transfer')).toBe(false)
  })
  it('sin medio usa el primero activo del catálogo', () => {
    expect(defaultMethodId(paymentMethods)).toBe('cash')
    expect(methodAffectsCash(paymentMethods, undefined)).toBe(true)
    const transferFirst = paymentMethods.map(method => (method.id === 'transfer' ? { ...method, sortOrder: -1 } : method))
    expect(methodAffectsCash(transferFirst, undefined)).toBe(false)
  })
  it('regla segura: medio desconocido o catálogo vacío afecta la caja', () => {
    expect(methodAffectsCash(paymentMethods, 'nequi')).toBe(true)
    expect(methodAffectsCash([], undefined)).toBe(true)
  })
  it('movementSign es el signo del tipo y 0 si el código no está en el catálogo', () => {
    expect(movementSign(movementTypes, 'deposit')).toBe(1)
    expect(movementSign(movementTypes, 'expense')).toBe(-1)
    expect(movementSign(movementTypes, 'desconocido')).toBe(0)
  })
})

describe('catalogEntryInUse', () => {
  const snapshot = {
    ...emptySnapshot(),
    services: [
      { id: 's1', date: '2026-11-01', amount: 1, method: 'transfer', updatedAt: 't' },
      { id: 's2', date: '2026-11-01', amount: 1, method: 'nequi', updatedAt: 't', deleted: true },
    ],
    movements: [{ id: 'm1', date: '2026-11-01', type: 'expense', amount: 1, categoryId: 'comida', method: 'cash', updatedAt: 't' }],
    fundMovements: [{ id: 'f1', date: '2026-11-01', categoryId: 'cat-gasolina', type: 'spend', amount: 1, updatedAt: 't' }],
  }
  it('detecta códigos usados por registros vivos', () => {
    expect(catalogEntryInUse(snapshot, 'paymentMethods', 'transfer')).toBe(true)
    expect(catalogEntryInUse(snapshot, 'paymentMethods', 'cash')).toBe(true) // movimiento
    expect(catalogEntryInUse(snapshot, 'movementTypes', 'expense')).toBe(true)
    expect(catalogEntryInUse(snapshot, 'expenseCategories', 'comida')).toBe(true)
    expect(catalogEntryInUse(snapshot, 'fundMovementTypes', 'spend')).toBe(true)
  })
  it('un registro con lápida no cuenta como uso', () => {
    expect(catalogEntryInUse(snapshot, 'paymentMethods', 'nequi')).toBe(false)
    expect(catalogEntryInUse(snapshot, 'expenseCategories', 'varios')).toBe(false)
    expect(catalogEntryInUse(snapshot, 'movementTypes', 'deposit')).toBe(false)
  })
})
