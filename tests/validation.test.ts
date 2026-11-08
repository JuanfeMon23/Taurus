import { describe, it, expect } from 'vitest'
import { validateCatalogEntryInput, validateFundMovementInput, validateMovementInput, validateShiftInput, validateShiftTemplateInput } from '../app/utils/validation'
import { GENERIC_ERROR, toUserMessage } from '../app/utils/errors'
import { ApiError } from '../app/services/apiStore'

describe('validateMovementInput', () => {
  it('rechaza monto vacío, cero o negativo con mensaje en español', () => {
    expect(validateMovementInput({ type: 'expense', amount: null })).toBe('Escribe un monto mayor que cero.')
    expect(validateMovementInput({ type: 'expense', amount: 0 })).toBe('Escribe un monto mayor que cero.')
    expect(validateMovementInput({ type: 'withdrawal', amount: -5 })).toBe('Escribe un monto mayor que cero.')
  })
  it('exige el tipo de movimiento', () => {
    expect(validateMovementInput({ type: '', amount: 10 })).toBe('Elige el tipo de movimiento.')
  })
  it('acepta un gasto válido', () => {
    expect(validateMovementInput({ type: 'expense', amount: 8000 })).toBeNull()
  })
})

describe('validateFundMovementInput', () => {
  const valid = { amount: 1000, date: '2026-11-07', categoryId: 'cat-gasolina' }
  it('acepta datos válidos', () => expect(validateFundMovementInput(valid)).toBeNull())
  it('exige fondo, fecha y monto positivo', () => {
    expect(validateFundMovementInput({ ...valid, categoryId: '' })).toBe('Elige el fondo.')
    expect(validateFundMovementInput({ ...valid, date: '' })).toBe('Elige una fecha válida.')
    expect(validateFundMovementInput({ ...valid, amount: 0 })).toBe('Escribe un monto mayor que cero.')
  })
})

describe('toUserMessage', () => {
  it('muestra el mensaje de ApiError y oculta cualquier otro error', () => {
    expect(toUserMessage(new ApiError('Sin conexión'))).toBe('Sin conexión')
    expect(toUserMessage(new Error('TypeError: x is undefined'))).toBe(GENERIC_ERROR)
    expect(toUserMessage('boom')).toBe(GENERIC_ERROR)
  })
})

describe('validateShiftInput', () => {
  it('exige inicio válido', () => {
    expect(validateShiftInput({ startTime: '' })).toBe('Escribe la hora de inicio del turno.')
    expect(validateShiftInput({ startTime: '25:00' })).toBe('La hora de inicio no es válida.')
  })
  it('rechaza fin inválido o igual al inicio', () => {
    expect(validateShiftInput({ startTime: '06:00', endTime: '99' })).toBe('La hora de fin no es válida.')
    expect(validateShiftInput({ startTime: '06:00', endTime: '06:00' })).toBe('El inicio y el fin del turno no pueden ser iguales.')
  })
  it('acepta turno cerrado, en curso y que cruza medianoche', () => {
    expect(validateShiftInput({ startTime: '06:00', endTime: '10:00' })).toBeNull()
    expect(validateShiftInput({ startTime: '06:00', endTime: '' })).toBeNull()
    expect(validateShiftInput({ startTime: '22:00', endTime: '02:00' })).toBeNull()
  })
})

describe('validateShiftTemplateInput', () => {
  const valid = { name: 'Mediodía', startTime: '12:00', endTime: '14:00' }
  it('acepta una plantilla válida, incluso si cruza la medianoche', () => {
    expect(validateShiftTemplateInput(valid)).toBeNull()
    expect(validateShiftTemplateInput({ ...valid, startTime: '22:00', endTime: '02:00' })).toBeNull()
  })
  it('exige nombre, inicio y fin válidos y distintos', () => {
    expect(validateShiftTemplateInput({ ...valid, name: '  ' })).toBe('Escribe el nombre de la plantilla.')
    expect(validateShiftTemplateInput({ ...valid, name: 'a'.repeat(41) })).toMatch(/40/)
    expect(validateShiftTemplateInput({ ...valid, startTime: '' })).toBe('Escribe la hora de inicio del turno.')
    expect(validateShiftTemplateInput({ ...valid, endTime: '' })).toBe('Escribe la hora de fin del turno.')
    expect(validateShiftTemplateInput({ ...valid, endTime: '25:00' })).toBe('La hora de fin no es válida.')
    expect(validateShiftTemplateInput({ ...valid, endTime: '12:00' })).toBe('El inicio y el fin del turno no pueden ser iguales.')
  })
})

describe('validateCatalogEntryInput', () => {
  it('exige nombre y longitud máxima', () => {
    expect(validateCatalogEntryInput('  ', [])).toBe('Escribe un nombre.')
    expect(validateCatalogEntryInput('a'.repeat(61), [])).toMatch(/60/)
  })
  it('rechaza nombres repetidos sin distinguir mayúsculas ni tildes', () => {
    expect(validateCatalogEntryInput('Café', ['Comida', 'cafe'])).toBe('Ya existe una opción con ese nombre.')
    expect(validateCatalogEntryInput('Peaje', ['Comida'])).toBeNull()
  })
  it('rechaza un nombre sin letras ni números (no genera código)', () => {
    expect(validateCatalogEntryInput('---', [])).toBe('El nombre debe tener letras o números.')
  })
})
