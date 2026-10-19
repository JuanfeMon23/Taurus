import { Fuel, Receipt, ShieldCheck, Wrench } from 'lucide-vue-next'

/** Icono de una categoría de costo según su nombre. */
export function categoryIcon(name: string) {
  if (/gasolina|combustible/i.test(name)) return Fuel
  if (/servicio|mantenim|aceite|llanta/i.test(name)) return Wrench
  if (/seguro|soat/i.test(name)) return ShieldCheck
  return Receipt
}
