const copFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export const money = (amount: number) => `$ ${copFormatter.format(Math.round(amount))}`
export const rate = (amount: number) => `${decimalFormatter.format(amount)} $/km`

export function todayISO(date = new Date()) {
  const padTwoDigits = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`
}

/** Monto corto para ejes de gráficas: "$ 1,5 M", "$ 300 k", "$ 850". */
export function moneyCompact(amount: number): string {
  const absolute = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (absolute >= 1_000_000) return `${sign}$ ${decimalFormatter.format(absolute / 1_000_000)} M`
  if (absolute >= 1_000) return `${sign}$ ${decimalFormatter.format(absolute / 1_000)} k`
  return `${sign}$ ${Math.round(absolute)}`
}

/** Número corto sin símbolo para ejes de gráficas: "1,2 M", "350 k", "850", "0,5" (los menores de 1000 conservan un decimal). */
export function numberCompact(amount: number): string {
  const absolute = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (absolute >= 1_000_000) return `${sign}${decimalFormatter.format(absolute / 1_000_000)} M`
  if (absolute >= 1_000) return `${sign}${decimalFormatter.format(absolute / 1_000)} k`
  return `${sign}${decimalFormatter.format(absolute)}`
}
