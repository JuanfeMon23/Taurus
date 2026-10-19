const cop = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })
const dec = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 })

export const money = (n: number) => `$ ${cop.format(Math.round(n))}`
export const rate = (n: number) => `${dec.format(n)} $/km`

export function todayISO(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
