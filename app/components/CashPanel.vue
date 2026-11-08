<script setup lang="ts">
import { ArrowLeftRight, Banknote, HandCoins, Lock, LockOpen, Plus, Scale, Trash2, Vault, Wallet } from 'lucide-vue-next'
import type { CashDay, DayRecord, DepositMovement } from '../services/types'
import { cashSummary, closingBase, depositBalance, keptInCash, suggestedOpening, validateClosing } from '../utils/cash'
import { defaultMethodId, entryName, methodAffectsCash, movementSign, movementTypeHasCategory } from '../utils/catalogs'
import { toUserMessage } from '../utils/errors'
import { money } from '../utils/format'
import { movementIcon, signTone } from '../utils/icons'
import { validateCatalogEntryInput, validateMovementInput } from '../utils/validation'

// Caja de la fecha recibida; `refreshKey` fuerza recarga cuando cambian los viajes del día.
// `compact` (Hoy): sin movimientos ni gestión de salidas del depósito; eso vive en la página Caja.
const props = defineProps<{ date: string; refreshKey?: number; compact?: boolean }>()
const day = ref<DayRecord | null>(null)
const cash = ref<CashDay | null>(null)
const opening = ref<number | null>(null)
const counted = ref<number | null>(null)
const toDeposit = ref<number | null>(null)
const allCash = ref<CashDay[]>([])
const outflows = ref<DepositMovement[]>([])
const openingTouched = ref(false)
const showMovement = ref(false)
const showOpen = ref(false)
const showClose = ref(false)
const showReopen = ref(false)
const showOutflow = ref(false)
const outflow = reactive({ amount: null as number | null, note: '' })
const NEW_CATEGORY = '__new__'
const { catalogs, activeMethods, activeMovementTypes, activeExpenseCategories, defaultMethod, refreshCatalogs } = useCatalogs()
const newMovement = reactive({ type: '', amount: null as number | null, note: '', categoryId: '', method: '' })
const newCategoryName = ref('')
const movementError = ref<string | null>(null)
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const isExpense = computed(() => movementTypeHasCategory(catalogs.value.movementTypes, newMovement.type))
const typeIndex = computed(() => Math.max(0, activeMovementTypes.value.findIndex(type => type.id === newMovement.type)))
const methodIndex = computed(() => Math.max(0, activeMethods.value.findIndex(method => method.id === newMovement.method)))
const typeLabel = (typeId: string) => entryName(catalogs.value.movementTypes, typeId)
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
const isOpen = computed(() => !!cash.value && !cash.value.closedAt)
const balance = computed(() => depositBalance(allCash.value, outflows.value))
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
  outflows.value = await taurus.repo.listDepositMovements()
  if (!cash.value && !openingTouched.value) {
    opening.value = suggestedOpening(allCash.value, await taurus.repo.listDays(), props.date, catalogs.value) ?? null
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
  Object.assign(newMovement, { type: activeMovementTypes.value[0]?.id ?? '', amount: null, note: '', categoryId: '', method: defaultMethod.value })
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
  movementError.value = validateMovementInput(newMovement)
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
      ...(categoryId ? { categoryId } : {}), method: isExpense.value ? newMovement.method : defaultMethodId(catalogs.value.paymentMethods),
    }] }, `${typeLabel(newMovement.type)} registrado`)
  } catch (error) {
    movementError.value = toUserMessage(error)
    return
  }
  resetMovement()
  showMovement.value = false
}
watch(showMovement, () => { movementError.value = null })
async function addOutflow() {
  if (!outflow.amount || outflow.amount <= 0) return
  await taurus.repo.saveDepositMovement({ date: props.date, amount: outflow.amount, note: outflow.note.trim() || undefined })
  Object.assign(outflow, { amount: null, note: '' })
  showOutflow.value = false
  await load()
  show('Salida del depósito registrada')
}
async function removeOutflow(id: string) {
  await taurus.repo.deleteDepositMovement(id)
  await load()
}
const removeMovement = (id: string) =>
  cash.value && save({ ...cash.value, movements: cash.value.movements.filter(movement => movement.id !== id) })
</script>

<template>
  <section class="stack">
    <!-- Sin abrir -->
    <div v-if="!cash" class="card stack">
      <div class="empty">
        <span class="icon-tile big"><Wallet :size="28" /></span>
        <b>Caja sin abrir</b>
        <p class="small">Registra el efectivo con el que empiezas el día.</p>
      </div>
      <button class="btn primary block" @click="showOpen = true"><LockOpen :size="18" /> Abrir caja</button>
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
          <div><span>Apertura</span><b class="num">{{ money(summary.opening) }}</b></div>
          <div><span class="pos">+ Servicios ({{ cashMethodNames }})</span><b class="num">{{ money(summary.cashIncome) }}</b></div>
          <div v-for="line in movementLines" :key="line.id"><span :class="line.sign > 0 ? 'pos' : line.sign < 0 ? 'neg' : ''">{{ line.sign > 0 ? '+' : line.sign < 0 ? '−' : '·' }} {{ line.name }}</span><b class="num">{{ money(line.amount) }}</b></div>
          <template v-if="!isOpen">
            <div><span>→ Al depósito</span><b class="num">{{ money(cash.toDeposit ?? 0) }}</b></div>
            <div><span>Queda en caja</span><b class="num">{{ money(closedKept) }}</b></div>
          </template>
          <div class="sep"><span>Saldo del depósito</span><b class="num">{{ money(balance) }}</b></div>
        </div>
        <div v-for="income in offCashIncome" :key="income.id" class="note">
          <ArrowLeftRight :size="16" /> {{ money(income.amount) }} por {{ income.name.toLowerCase() }} (no entran a caja)
        </div>
        <button v-if="isOpen" class="btn primary block" @click="showClose = true"><Lock :size="18" /> Cerrar caja</button>
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
            <span class="icon-tile" :class="signTone(movementSign(catalogs.movementTypes, movement.type))"><component :is="movementIcon(movement.type, movementSign(catalogs.movementTypes, movement.type))" :size="20" /></span>
            <div class="grow">
              <b>{{ typeLabel(movement.type) }}<span v-if="movement.categoryId"> · {{ entryName(catalogs.expenseCategories, movement.categoryId) }}</span></b>
              <span v-if="movement.method && !methodAffectsCash(catalogs.paymentMethods, movement.method)" class="chip info tag">{{ entryName(catalogs.paymentMethods, movement.method) }}</span>
              <p v-if="movement.note" class="muted small">{{ movement.note }}</p>
            </div>
            <b class="num" :class="signTone(movementSign(catalogs.movementTypes, movement.type))">{{ movementSign(catalogs.movementTypes, movement.type) > 0 ? '+' : '−' }} {{ money(movement.amount) }}</b>
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
        <button class="btn block" @click="showReopen = true"><LockOpen :size="18" /> Reabrir caja</button>
      </div>
    </template>

    <!-- Depósito (solo en la página Caja) -->
    <div v-if="!compact" class="card stack">
      <div class="row between">
        <span class="title">Depósito</span>
        <button v-if="cash" class="btn small-btn" @click="showOutflow = true"><Plus :size="16" /> Registrar salida</button>
      </div>
      <p class="small-total"><Vault :size="22" /> {{ money(balance) }}</p>
      <p class="small muted">Saldo = lo llevado al depósito en los cierres − las salidas.</p>
      <p v-if="!outflows.length" class="muted small">Sin salidas del depósito.</p>
      <div v-else class="stack" style="gap: 8px">
        <div v-for="depositMovement in outflows" :key="depositMovement.id" class="row mv">
          <span class="icon-tile neg"><HandCoins :size="20" /></span>
          <div class="grow">
            <b>{{ depositMovement.date }}</b>
            <p v-if="depositMovement.note" class="muted small">{{ depositMovement.note }}</p>
          </div>
          <b class="num neg">− {{ money(depositMovement.amount) }}</b>
          <button class="btn icon ghost" aria-label="Eliminar salida" @click="removeOutflow(depositMovement.id)"><Trash2 :size="17" /></button>
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
        <button type="submit" class="btn primary block"><LockOpen :size="18" /> Confirmar apertura</button>
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
        <button type="submit" class="btn primary block" :disabled="!!closeError"><Lock :size="18" /> Confirmar cierre</button>
      </form>
    </BaseModal>

    <!-- Reabrir -->
    <BaseModal :open="showReopen" title="Reabrir caja" @close="showReopen = false">
      <div class="stack">
        <p class="small">Se borrará lo contado y lo enviado al depósito en el cierre ({{ money(cash?.toDeposit ?? 0) }}). Tendrás que cerrar la caja de nuevo.</p>
        <button type="button" class="btn primary block" @click="reopen"><LockOpen :size="18" /> Confirmar reapertura</button>
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
          <div class="seg" :style="{ '--n': Math.max(activeMethods.length, 1), '--i': methodIndex }" role="group" aria-label="Medio de pago">
            <span class="thumb" />
            <button v-for="method in activeMethods" :key="method.id" type="button" :class="{ active: newMovement.method === method.id }" @click="newMovement.method = method.id">{{ method.name }}</button>
          </div>
          <p v-if="!methodAffectsCash(catalogs.paymentMethods, newMovement.method)" class="small muted">Con {{ entryName(catalogs.paymentMethods, newMovement.method).toLowerCase() }} no sale dinero de la caja.</p>
        </template>
        <input v-model.number="newMovement.amount" type="number" inputmode="decimal" min="0" placeholder="Monto" aria-label="Monto" class="input">
        <input v-model="newMovement.note" type="text" placeholder="Nota (opcional)" aria-label="Nota" class="input">
        <p v-if="movementError" class="err" role="alert">{{ movementError }}</p>
        <button type="submit" class="btn primary block"><Plus :size="18" /> Agregar</button>
      </form>
    </BaseModal>

    <BaseModal v-if="!compact" :open="showOutflow" title="Salida del depósito" @close="showOutflow = false">
      <form class="stack" @submit.prevent="addOutflow">
        <p class="small muted">Fecha: {{ date }}</p>
        <input v-model.number="outflow.amount" type="number" inputmode="decimal" min="0" placeholder="Monto" aria-label="Monto" class="input">
        <input v-model="outflow.note" type="text" placeholder="Nota (p. ej. pago de moto)" aria-label="Nota" class="input">
        <button type="submit" class="btn primary block"><Plus :size="18" /> Registrar</button>
      </form>
    </BaseModal>
  </section>
</template>

<style scoped>
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
