<script setup lang="ts">
import { ArrowLeftRight, Banknote, HandCoins, Lock, LockOpen, Plus, Scale, Trash2, Vault, Wallet } from 'lucide-vue-next'
import type { CashDay, CashMovement, DatedMovement, DayRecord } from '../services/types'
import { accountBalances, DEPOSIT_ACCOUNT_ID, movementDirection } from '../utils/accounts'
import { cashSummary, closingBase, keptInCash, suggestedOpening, validateClosing } from '../utils/cash'
import { accountIsCashBox, entryName, methodAffectsCash, movementSign, movementTypeHasCategory, movementTypeRequiresDestination } from '../utils/catalogs'
import { toUserMessage } from '../utils/errors'
import { money } from '../utils/format'
import { accountIcon, movementIcon, signTone } from '../utils/icons'
import { validateCatalogEntryInput, validateMovementInput } from '../utils/validation'

// Caja de la fecha recibida; `refreshKey` fuerza recarga cuando cambian los viajes del día.
// `compact` (Hoy): sin movimientos, saldos completos ni gestión del depósito; eso vive en la página Caja.
const props = defineProps<{ date: string; refreshKey?: number; compact?: boolean }>()
const day = ref<DayRecord | null>(null)
const cash = ref<CashDay | null>(null)
const opening = ref<number | null>(null)
const counted = ref<number | null>(null)
const toDeposit = ref<number | null>(null)
const allCash = ref<CashDay[]>([])
const days = ref<DayRecord[]>([])
const movements = ref<DatedMovement[]>([])
const openingTouched = ref(false)
const showMovement = ref(false)
const showOpen = ref(false)
const showClose = ref(false)
const showReopen = ref(false)
const NEW_CATEGORY = '__new__'
const { catalogs, activeAccounts, activeMethods, cashBoxId, activeMovementTypes, activeExpenseCategories, refreshCatalogs } = useCatalogs()
const newMovement = reactive({ type: '', amount: null as number | null, note: '', categoryId: '', accountId: '', toAccountId: '' })
const newCategoryName = ref('')
const movementError = ref<string | null>(null)
const { show } = useNotify()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const isExpense = computed(() => movementTypeHasCategory(catalogs.value.movementTypes, newMovement.type))
const typeIndex = computed(() => Math.max(0, activeMovementTypes.value.findIndex(type => type.id === newMovement.type)))
const requiresDestination = computed(() => movementTypeRequiresDestination(catalogs.value.movementTypes, newMovement.type))
// Destino de un traslado: cualquier cuenta activa menos la de origen.
const destinationChoices = computed(() => activeAccounts.value.filter(account => account.id !== newMovement.accountId))
const accountName = (accountId: string | undefined) => entryName(catalogs.value.accounts, accountId)
// «Origen → destino» en un traslado; el nombre de la cuenta si no es la caja; nada si es un movimiento corriente de la caja.
const accountLabel = (movement: CashMovement) => movement.toAccountId
  ? `${accountName(movement.accountId)} → ${accountName(movement.toAccountId)}`
  : accountIsCashBox(catalogs.value.accounts, movement.accountId) ? '' : accountName(movement.accountId)
const typeLabel = (typeId: string) => entryName(catalogs.value.movementTypes, typeId)
// Efecto en la lista de la caja: un traslado que llega a la caja suma; los de otras cuentas conservan el signo de su tipo.
const listDirection = (movement: CashMovement) => movementDirection(movement, cashBoxId.value, catalogs.value.movementTypes) || movementSign(catalogs.value.movementTypes, movement.type)
const cashMethodNames = computed(() => activeMethods.value.filter(method => method.affectsCash).map(method => method.name).join(' / ') || 'caja')

const summary = computed(() => cashSummary(day.value, cash.value, catalogs.value))
// Una línea por tipo de movimiento: los de resta siempre; los demás solo si tienen monto. Un código que no está en el catálogo se muestra con su código.
const movementLines = computed(() => {
  const known = catalogs.value.movementTypes.map(type => type.id)
  const ids = [...activeMovementTypes.value.map(type => type.id), ...[...summary.value.totalsByType.keys()].filter(id => !known.includes(id))]
  return ids
    .map(id => ({ id, name: typeLabel(id), sign: movementSign(catalogs.value.movementTypes, id), amount: summary.value.totalsByType.get(id) ?? 0 }))
    .filter(line => line.amount !== 0 || line.sign < 0)
})
// Ingresos de viajes en medios que no mueven la caja, con el nombre del medio.
const offCashIncome = computed(() => [...summary.value.incomeByMethod]
  .filter(([methodId, amount]) => amount > 0 && !methodAffectsCash(catalogs.value.paymentMethods, methodId))
  .map(([methodId, amount]) => ({ id: methodId, name: entryName(catalogs.value.paymentMethods, methodId), amount })))
// Líneas del resumen (Hoy compacto y página Caja): apertura, servicios en efectivo, una por movimiento y, cerrada, destino del cierre; al final el saldo del depósito.
type SummaryLine = { key: string, label: string, tone: '' | 'pos' | 'neg', amount: number, separated?: boolean }
const summaryLines = computed<SummaryLine[]>(() => {
  const lines: SummaryLine[] = [
    { key: 'opening', label: 'Apertura', tone: '', amount: summary.value.opening },
    { key: 'income', label: `+ Servicios (${cashMethodNames.value})`, tone: 'pos', amount: summary.value.cashIncome },
    ...movementLines.value.map((line): SummaryLine => ({ key: line.id, label: `${line.sign > 0 ? '+' : line.sign < 0 ? '−' : '·'} ${line.name}`, tone: line.sign > 0 ? 'pos' : line.sign < 0 ? 'neg' : '', amount: line.amount })),
  ]
  if (summary.value.transfersIn) lines.push({ key: 'transfersIn', label: '+ Traslados recibidos', tone: 'pos', amount: summary.value.transfersIn })
  if (cash.value && cash.value.closedAt) {
    lines.push({ key: 'toDeposit', label: '→ Al depósito', tone: '', amount: cash.value.toDeposit ?? 0 }, { key: 'kept', label: 'Queda en caja', tone: '', amount: closedKept.value })
  }
  return lines
})
const isOpen = computed(() => !!cash.value && !cash.value.closedAt)
// Saldos de todas las cuentas; la caja sigue el ciclo diario (efectivo esperado / queda en caja).
const balances = computed(() => accountBalances({ ...catalogs.value, movements: movements.value, cashes: allCash.value, days: days.value }))
const otherBalances = computed(() => balances.value.filter(entry => !entry.account.isCashBox))
const depositBalanceNow = computed(() => balances.value.find(entry => entry.account.id === DEPOSIT_ACCOUNT_ID)?.balance ?? 0)
const depositOutflows = computed(() => movements.value.filter(movement => movement.accountId === DEPOSIT_ACCOUNT_ID))
// Cierre en curso: la base es lo contado o, sin conteo, el esperado.
const closeError = computed(() => validateClosing({ expected: summary.value.expected, counted: counted.value, toDeposit: toDeposit.value }))
const kept = computed(() => keptInCash(closingBase(summary.value.expected, counted.value ?? undefined), toDeposit.value ?? undefined))
const closedKept = computed(() => keptInCash(closingBase(summary.value.expected, summary.value.counted), cash.value?.toDeposit))

async function load() {
  day.value = await taurus.repo.getDay(props.date)
  cash.value = await taurus.repo.getCash(props.date)
  counted.value = cash.value?.counted ?? null
  toDeposit.value = cash.value?.toDeposit ?? null
  allCash.value = await taurus.repo.listCash()
  days.value = await taurus.repo.listDays()
  movements.value = await taurus.repo.listMovements()
  if (!cash.value && !openingTouched.value) {
    opening.value = suggestedOpening(allCash.value, days.value, props.date, catalogs.value) ?? null
  }
}
onMounted(async () => {
  taurus = await useTaurus()
  await refreshCatalogs()
  resetMovement()
  await load()
})
onActivated(async () => {
  if (!taurus) return
  await refreshCatalogs()
  await load()
})
watch(() => props.date, () => { openingTouched.value = false })
watch(() => [props.date, props.refreshKey], () => taurus && load())

async function save(cashDay: CashDay, message?: string) {
  await taurus.repo.putCash(cashDay)
  await load()
  if (message) show(message)
}
async function open() {
  await save({ date: props.date, opening: opening.value ?? 0, openedAt: new Date().toISOString(), movements: [] }, 'Caja abierta')
  showOpen.value = false
}
async function reopen() {
  if (!cash.value) return
  await save({ ...cash.value, closedAt: undefined, counted: undefined, toDeposit: undefined }, 'Caja reabierta')
  showReopen.value = false
}
async function close() {
  if (!cash.value || closeError.value) return
  await save({ ...cash.value, closedAt: new Date().toISOString(), counted: counted.value ?? undefined, toDeposit: toDeposit.value || undefined }, 'Caja cerrada')
  showClose.value = false
}

function resetMovement() {
  Object.assign(newMovement, { type: activeMovementTypes.value[0]?.id ?? '', amount: null, note: '', categoryId: '', accountId: cashBoxId.value, toAccountId: '' })
  newCategoryName.value = ''
}

async function createCategory() {
  movementError.value = validateCatalogEntryInput(newCategoryName.value, catalogs.value.expenseCategories.map(category => category.name))
  if (movementError.value) return
  try {
    const created = await taurus.repo.saveCatalogEntry('expenseCategories', { name: newCategoryName.value })
    await refreshCatalogs()
    newMovement.categoryId = created.id
    newCategoryName.value = ''
  } catch (error) {
    movementError.value = toUserMessage(error)
  }
}

async function addMovement() {
  if (!cash.value) return
  movementError.value = validateMovementInput({ ...newMovement, requiresDestination: requiresDestination.value })
  if (movementError.value || !newMovement.amount) return
  if (newMovement.categoryId === NEW_CATEGORY) {
    movementError.value = 'Crea la categoría nueva o elige otra.'
    return
  }
  const categoryId = isExpense.value ? newMovement.categoryId : ''
  try {
    // id vacío: el dominio asigna un id único al guardarlo.
    await save({ ...cash.value, movements: [...cash.value.movements, {
      id: '', type: newMovement.type, amount: newMovement.amount, note: newMovement.note.trim() || undefined,
      ...(categoryId ? { categoryId } : {}), accountId: newMovement.accountId, ...(requiresDestination.value ? { toAccountId: newMovement.toAccountId } : {}),
    }] }, `${typeLabel(newMovement.type)} registrado`)
  } catch (error) {
    movementError.value = toUserMessage(error)
    return
  }
  resetMovement()
  showMovement.value = false
}
watch(showMovement, () => { movementError.value = null })
// El destino de un traslado nunca es el origen: se propone la primera cuenta distinta.
watch(() => [newMovement.type, newMovement.accountId], () => {
  if (!requiresDestination.value) newMovement.toAccountId = ''
  else if (!destinationChoices.value.some(account => account.id === newMovement.toAccountId)) newMovement.toAccountId = destinationChoices.value[0]?.id ?? ''
})
// «Registrar salida» del depósito: el mismo modal de movimiento, con la cuenta depósito y un tipo que resta.
function openDepositOutflow() {
  resetMovement()
  const outflowType = activeMovementTypes.value.find(type => type.sign < 0 && !type.hasCategory && !type.requiresDestination)
  Object.assign(newMovement, { type: outflowType?.id ?? newMovement.type, accountId: DEPOSIT_ACCOUNT_ID })
  showMovement.value = true
}
async function removeDepositOutflow(id: string) {
  await taurus.repo.deleteMovement(id)
  await load()
}
const removeMovement = (id: string) =>
  cash.value && save({ ...cash.value, movements: cash.value.movements.filter(movement => movement.id !== id) })
</script>

<template>
  <section class="stack">
    <!-- Saldos de las cuentas (solo en la página Caja) -->
    <div v-if="!compact" class="card stack">
      <span class="title">Saldos</span>
      <div class="balances">
        <div v-for="entry in balances" :key="entry.account.id" class="balance">
          <span class="icon-tile"><component :is="accountIcon(entry.account.id, entry.account.isCashBox)" :size="20" /></span>
          <div>
            <p class="small muted">{{ entry.account.name }}</p>
            <b class="num balance-amount" :class="{ neg: entry.balance < 0 }">{{ money(entry.balance) }}</b>
          </div>
        </div>
      </div>
    </div>

    <!-- Hoy (compacto): una sola tarjeta con estado, efectivo esperado y acción principal -->
    <div v-if="compact" class="card stack compact-card">
      <div class="row between">
        <span class="title cash-title"><Wallet :size="16" /> Caja</span>
        <span v-if="cash" class="badge" :class="isOpen ? 'open' : 'closed'"><component :is="isOpen ? LockOpen : Lock" :size="13" /> {{ isOpen ? 'Abierta' : 'Cerrada' }}</span>
        <span v-else class="badge closed">Sin abrir</span>
      </div>
      <template v-if="!cash">
        <p class="small muted">Registra el efectivo con el que empiezas el día.</p>
        <button type="button" class="btn primary full" @click="showOpen = true"><LockOpen :size="18" /> Abrir caja</button>
      </template>
      <template v-else>
        <div class="row between cash-head">
          <div>
            <p class="small muted">Efectivo esperado</p>
            <p class="cash-total"><AnimatedNumber :value="summary.expected" /></p>
          </div>
          <button v-if="isOpen" type="button" class="btn primary" @click="showClose = true"><Lock :size="18" /> Cerrar caja</button>
          <button v-else type="button" class="btn" @click="showReopen = true"><LockOpen :size="18" /> Reabrir caja</button>
        </div>
        <div class="cash-lines">
          <div v-for="line in summaryLines" :key="line.key" :class="{ sep: line.separated }">
            <span :class="line.tone">{{ line.label }}</span><b class="num">{{ money(line.amount) }}</b>
          </div>
          <div v-if="!isOpen && summary.counted !== undefined"><span>Contado</span><b class="num">{{ money(summary.counted) }}</b></div>
          <div v-if="!isOpen && summary.difference !== undefined">
            <span :class="summary.difference < 0 ? 'neg' : 'pos'">{{ summary.difference < 0 ? 'Faltante' : summary.difference > 0 ? 'Sobrante' : 'Cuadra' }}</span>
            <b class="num" :class="summary.difference < 0 ? 'neg' : 'pos'">{{ money(Math.abs(summary.difference)) }}</b>
          </div>
        </div>
        <div v-if="otherBalances.length" class="cash-lines balances-row" aria-label="Saldos de las otras cuentas">
          <div v-for="entry in otherBalances" :key="entry.account.id"><span>{{ entry.account.name }}</span><b class="num">{{ money(entry.balance) }}</b></div>
        </div>
        <div v-for="income in offCashIncome" :key="income.id" class="note">
          <ArrowLeftRight :size="16" /> {{ money(income.amount) }} por {{ income.name.toLowerCase() }} (no entran a caja)
        </div>
      </template>
    </div>

    <!-- Caja completa (página Caja) -->
    <div v-else-if="!cash" class="card stack">
      <div class="empty">
        <span class="icon-tile big"><Wallet :size="28" /></span>
        <b>Caja sin abrir</b>
        <p class="small">Registra el efectivo con el que empiezas el día.</p>
      </div>
      <button class="btn primary full" @click="showOpen = true"><LockOpen :size="18" /> Abrir caja</button>
    </div>

    <template v-else>
      <!-- Resumen -->
      <div class="card stack">
        <div class="row between">
          <span class="title">Efectivo esperado</span>
          <span class="badge" :class="isOpen ? 'open' : 'closed'">
            <component :is="isOpen ? LockOpen : Lock" :size="13" /> {{ isOpen ? 'Abierta' : 'Cerrada' }}
          </span>
        </div>
        <p class="total"><AnimatedNumber :value="summary.expected" /></p>
        <div class="lines">
          <div v-for="line in summaryLines" :key="line.key" :class="{ sep: line.separated }"><span :class="line.tone">{{ line.label }}</span><b class="num">{{ money(line.amount) }}</b></div>
        </div>
        <div v-for="income in offCashIncome" :key="income.id" class="note">
          <ArrowLeftRight :size="16" /> {{ money(income.amount) }} por {{ income.name.toLowerCase() }} (no entran a caja)
        </div>
        <button v-if="isOpen" class="btn primary full" @click="showClose = true"><Lock :size="18" /> Cerrar caja</button>
      </div>

      <!-- Movimientos (solo en la página Caja) -->
      <div v-if="isOpen && !compact" class="card stack">
        <div class="row between">
          <span class="title">Movimientos</span>
          <button class="btn small-btn" @click="showMovement = true"><Plus :size="16" /> Nuevo movimiento</button>
        </div>
        <p v-if="!cash.movements.length" class="muted small">Sin movimientos.</p>
        <TransitionGroup name="list" tag="div" class="stack rel" style="gap: 8px">
          <div v-for="movement in cash.movements" :key="movement.id" class="row mv">
            <span class="icon-tile" :class="signTone(listDirection(movement))"><component :is="movementIcon(movement.type, listDirection(movement))" :size="20" /></span>
            <div class="grow">
              <b>{{ typeLabel(movement.type) }}<span v-if="movement.categoryId"> · {{ entryName(catalogs.expenseCategories, movement.categoryId) }}</span></b>
              <span v-if="accountLabel(movement)" class="chip info tag">{{ accountLabel(movement) }}</span>
              <p v-if="movement.note" class="muted small">{{ movement.note }}</p>
            </div>
            <b class="num" :class="signTone(listDirection(movement))">{{ listDirection(movement) > 0 ? '+' : '−' }} {{ money(movement.amount) }}</b>
            <button class="btn icon ghost" aria-label="Eliminar" @click="removeMovement(movement.id)"><Trash2 :size="17" /></button>
          </div>
        </TransitionGroup>
      </div>

      <div v-if="!isOpen" class="card stack">
        <div class="lines">
          <div><span>Contado</span><b class="num">{{ summary.counted === undefined ? '—' : money(summary.counted) }}</b></div>
          <div v-if="summary.difference !== undefined">
            <span>{{ summary.difference < 0 ? 'Faltante' : summary.difference > 0 ? 'Sobrante' : 'Cuadra' }}</span>
            <b class="num" :class="summary.difference < 0 ? 'neg' : 'pos'">{{ money(Math.abs(summary.difference)) }}</b>
          </div>
        </div>
        <button class="btn full" @click="showReopen = true"><LockOpen :size="18" /> Reabrir caja</button>
      </div>
    </template>

    <!-- Depósito (solo en la página Caja) -->
    <div v-if="!compact" class="card stack">
      <div class="row between">
        <span class="title">Depósito</span>
        <button v-if="cash" class="btn small-btn" @click="openDepositOutflow"><Plus :size="16" /> Registrar salida</button>
      </div>
      <p class="small-total"><Vault :size="22" /> {{ money(depositBalanceNow) }}</p>
      <p class="small muted">Saldo = lo llevado al depósito en los cierres + traslados que llegan − salidas.</p>
      <p v-if="!depositOutflows.length" class="muted small">Sin salidas del depósito.</p>
      <div v-else class="stack" style="gap: 8px">
        <div v-for="outflow in depositOutflows" :key="outflow.id" class="row mv">
          <span class="icon-tile neg"><HandCoins :size="20" /></span>
          <div class="grow">
            <b>{{ outflow.date }} · {{ typeLabel(outflow.type) }}</b>
            <p v-if="outflow.note" class="muted small">{{ outflow.note }}</p>
          </div>
          <b class="num neg">− {{ money(outflow.amount) }}</b>
          <button class="btn icon ghost" aria-label="Eliminar salida" @click="removeDepositOutflow(outflow.id)"><Trash2 :size="17" /></button>
        </div>
      </div>
    </div>

    <!-- Apertura -->
    <BaseModal :open="showOpen" title="Abrir caja" @close="showOpen = false">
      <form class="stack" @submit.prevent="open">
        <label class="field">
          <span>Efectivo de apertura</span>
          <div class="input-icon">
            <Banknote :size="18" />
            <input v-model.number="opening" type="number" inputmode="decimal" placeholder="0" class="input" @input="openingTouched = true">
          </div>
        </label>
        <p v-if="opening && !openingTouched" class="small muted">Sugerido: lo que quedó en caja en el último cierre.</p>
        <button type="submit" class="btn primary full"><LockOpen :size="18" /> Confirmar apertura</button>
      </form>
    </BaseModal>

    <!-- Cierre -->
    <BaseModal :open="showClose" title="Cerrar caja" @close="showClose = false">
      <form class="stack" @submit.prevent="close">
        <div class="lines">
          <div><span>Efectivo esperado</span><b class="num">{{ money(summary.expected) }}</b></div>
          <div><span>Apertura</span><b class="num">{{ money(summary.opening) }}</b></div>
          <div><span class="pos">+ Servicios ({{ cashMethodNames }})</span><b class="num">{{ money(summary.cashIncome) }}</b></div>
          <div v-for="line in movementLines" :key="line.id"><span :class="line.sign > 0 ? 'pos' : line.sign < 0 ? 'neg' : ''">{{ line.sign > 0 ? '+' : line.sign < 0 ? '−' : '·' }} {{ line.name }}</span><b class="num">{{ money(line.amount) }}</b></div>
        </div>
        <label class="field">
          <span>Contado (opcional)</span>
          <div class="input-icon">
            <Scale :size="18" />
            <input v-model.number="counted" type="number" inputmode="decimal" placeholder="0" class="input">
          </div>
        </label>
        <label class="field">
          <span>Va al depósito</span>
          <div class="input-icon">
            <Vault :size="18" />
            <input v-model.number="toDeposit" type="number" inputmode="decimal" min="0" placeholder="0" class="input" :aria-invalid="!!closeError">
          </div>
        </label>
        <div class="lines">
          <div><span>Queda en caja</span><b class="num" :class="{ neg: kept < 0 }">{{ money(kept) }}</b></div>
        </div>
        <p v-if="closeError" class="err" role="alert">{{ closeError }}</p>
        <button type="submit" class="btn primary full" :disabled="!!closeError"><Lock :size="18" /> Confirmar cierre</button>
      </form>
    </BaseModal>

    <!-- Reabrir -->
    <BaseModal :open="showReopen" title="Reabrir caja" @close="showReopen = false">
      <div class="stack">
        <p class="small">Se borrará lo contado y lo enviado al depósito en el cierre ({{ money(cash?.toDeposit ?? 0) }}). Tendrás que cerrar la caja de nuevo.</p>
        <button type="button" class="btn primary full" @click="reopen"><LockOpen :size="18" /> Confirmar reapertura</button>
      </div>
    </BaseModal>

    <BaseModal v-if="!compact" :open="showMovement" title="Nuevo movimiento" @close="showMovement = false">
      <form class="stack" @submit.prevent="addMovement">
        <div class="seg" :style="{ '--n': Math.max(activeMovementTypes.length, 1), '--i': typeIndex }" role="group" aria-label="Tipo de movimiento">
          <span class="thumb" />
          <button v-for="movementType in activeMovementTypes" :key="movementType.id" type="button" :class="{ active: newMovement.type === movementType.id }" @click="newMovement.type = movementType.id">{{ movementType.name }}</button>
        </div>
        <template v-if="isExpense">
          <select v-model="newMovement.categoryId" aria-label="Categoría" class="input">
            <option value="">Sin categoría</option>
            <option v-for="category in activeExpenseCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
            <option :value="NEW_CATEGORY">+ Nueva categoría</option>
          </select>
          <div v-if="newMovement.categoryId === NEW_CATEGORY" class="row">
            <input v-model="newCategoryName" type="text" maxlength="60" placeholder="Nombre de la categoría" aria-label="Nombre de la categoría nueva" class="input grow" @keydown.enter.prevent="createCategory">
            <button type="button" class="btn" @click="createCategory"><Plus :size="16" /> Crear</button>
          </div>
        </template>
        <label class="field">
          <span>Cuenta</span>
          <select v-model="newMovement.accountId" class="input">
            <option v-for="account in activeAccounts" :key="account.id" :value="account.id">{{ account.name }}</option>
          </select>
        </label>
        <label v-if="requiresDestination" class="field">
          <span>Hacia</span>
          <select v-model="newMovement.toAccountId" class="input">
            <option v-for="account in destinationChoices" :key="account.id" :value="account.id">{{ account.name }}</option>
          </select>
        </label>
        <input v-model.number="newMovement.amount" type="number" inputmode="decimal" min="0" placeholder="Monto" aria-label="Monto" class="input">
        <input v-model="newMovement.note" type="text" placeholder="Nota (opcional)" aria-label="Nota" class="input">
        <p v-if="movementError" class="err" role="alert">{{ movementError }}</p>
        <button type="submit" class="btn primary full"><Plus :size="18" /> Agregar</button>
      </form>
    </BaseModal>

  </section>
</template>

<style scoped>
.compact-card { padding: 12px; gap: 10px; }
.cash-title { display: inline-flex; align-items: center; gap: 6px; }
.cash-head { align-items: flex-end; }
.cash-head p { margin: 0; }
.cash-total { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.cash-lines { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 20px; font-size: 13px; }
.cash-lines > div { display: flex; justify-content: space-between; gap: 8px; min-width: 0; color: var(--text-2); }
.cash-lines > div > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.balances-row { padding-top: 6px; border-top: 1px solid var(--border); }
.balances { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.balance { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; background: var(--surface-2); }
.balance p { margin: 0; }
.balance-amount { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.cash-lines > .sep { grid-column: 1 / -1; padding-top: 4px; border-top: 1px solid var(--border); }
.rel { position: relative; }
.big { width: 64px; height: 64px; border-radius: 20px; }
.total { font-size: 42px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.lines { display: flex; flex-direction: column; gap: 8px; }
.lines > div { display: flex; justify-content: space-between; color: var(--text-2); }
.lines > .sep { padding-top: 8px; border-top: 1px solid var(--border); }
.small-total { display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 800; }
.small-btn { padding: 6px 10px; font-size: 13px; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
.note { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--info-soft); color: var(--info); font-size: 13px; font-weight: 600; }
.tag { display: inline-flex; margin-top: 2px; font-size: 11px; padding: 2px 8px; }
.mv { background: var(--surface-2); border-radius: 14px; padding: 10px; }
</style>
