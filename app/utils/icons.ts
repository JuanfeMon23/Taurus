import { ArrowDownToLine, ArrowLeftRight, ArrowUpCircle, ArrowUpFromLine, Banknote, CarTaxiFront, Fuel, HandCoins, Landmark, PiggyBank, Receipt, ShieldCheck, Smartphone, Vault, Wallet, Wrench } from 'lucide-vue-next'

/** Icono de una categoría de costo según su nombre. */
export function categoryIcon(name: string) {
  if (/gasolina|combustible/i.test(name)) return Fuel
  if (/servicio|mantenim|aceite|llanta/i.test(name)) return Wrench
  if (/seguro|soat/i.test(name)) return ShieldCheck
  return Receipt
}

/* Íconos por código de catálogo: solo presentación; un código nuevo cae en el ícono genérico. */
const METHOD_ICONS = { cash: Banknote, transfer: Smartphone, bancolombia: Landmark }
const ACCOUNT_ICONS = { caja: Wallet, transferencias: Smartphone, bancolombia: Landmark, deposito: Vault, indrive: CarTaxiFront }
const MOVEMENT_ICONS = { expense: ArrowUpCircle, withdrawal: HandCoins, deposit: PiggyBank }
const FUND_MOVEMENT_ICONS = { transfer: ArrowDownToLine, spend: ArrowUpFromLine }

const pick = <Icon>(icons: Record<string, Icon>, code: string, fallback: Icon): Icon => icons[code] ?? fallback

/** Ícono de un medio de pago; el genérico depende de si mueve el efectivo. */
export const methodIcon = (code: string, affectsCash: boolean) => pick(METHOD_ICONS, code, affectsCash ? Banknote : ArrowLeftRight)

/** Ícono de una cuenta; el genérico depende de si es la caja. */
export const accountIcon = (code: string, isCashBox: boolean) => pick(ACCOUNT_ICONS, code, isCashBox ? Wallet : Landmark)

/** Ícono de un tipo de movimiento de caja; el genérico depende del signo. */
export const movementIcon = (code: string, sign: number) => pick(MOVEMENT_ICONS, code, sign > 0 ? PiggyBank : ArrowUpCircle)

/** Ícono de un tipo de movimiento de fondo; el genérico depende del signo. */
export const fundMovementIcon = (code: string, sign: number) => pick(FUND_MOVEMENT_ICONS, code, sign > 0 ? ArrowDownToLine : ArrowUpFromLine)

/** Tono visual (clases `pos` / `neg` / `info`) según el signo. */
export const signTone = (sign: number): 'pos' | 'neg' => (sign > 0 ? 'pos' : 'neg')
