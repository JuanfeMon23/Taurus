const copFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export const money = (amount: number) => `$ ${copFormatter.format(Math.round(amount))}`
export const rate = (amount: number) => `${decimalFormatter.format(amount)} $/km`

export function todayISO(date = new Date()) {
  const padTwoDigits = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`
}
