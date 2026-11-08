<script setup lang="ts">
import { CalendarDays, PiggyBank, Trash2 } from 'lucide-vue-next'
import type { Category } from '../utils/calc'
import type { DayRecord, FundMovement } from '../services/types'
import { entryName, movementSign } from '../utils/catalogs'
import { toUserMessage } from '../utils/errors'
import { money, todayISO } from '../utils/format'
import { fundStatus, type FundRange, type FundStatus } from '../utils/funds'
import { fundMovementIcon, signTone } from '../utils/icons'
import { validateFundMovementInput } from '../utils/validation'

type RangeMode = 'month' | 'all'
const RANGE_MODES = [['month', 'Este mes'], ['all', 'Todo']] as const

const days = ref<DayRecord[]>([])
const categories = ref<Category[]>([])
const movements = ref<FundMovement[]>([])
const rangeMode = ref<RangeMode>('month')
const { catalogs, activeFundTypes, refreshCatalogs } = useCatalogs()
const modal = reactive({ open: false, type: '', categoryId: '', amount: null as number | null, note: '', date: todayISO(), error: null as string | null })
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

async function load() {
  taurus = await useTaurus()
  days.value = await taurus.repo.listDays()
  categories.value = await taurus.repo.listCategories()
  movements.value = await taurus.repo.listFundMovements()
  await refreshCatalogs()
}
onMounted(load)
onActivated(load)

const range = computed<FundRange | undefined>(() => {
  if (rangeMode.value === 'all') return undefined
  const month = todayISO().slice(0, 7)
  return { from: `${month}-01`, to: `${month}-31` }
})

const categoryName = (categoryId: string) => categories.value.find(category => category.id === categoryId)?.name ?? categoryId
const typeName = (typeId: string) => entryName(catalogs.value.fundMovementTypes, typeId)
const typeSign = (typeId: string) => movementSign(catalogs.value.fundMovementTypes, typeId)
const modalTitle = (typeId: string) => `Registrar ${typeName(typeId).toLowerCase()}`

// Un fondo por cada categoría de costo, aunque aún no tenga movimientos.
const funds = computed<FundStatus[]>(() => {
  const statuses = fundStatus(days.value, movements.value, catalogs.value.fundMovementTypes, range.value).map(status => ({ ...status, name: categoryName(status.categoryId) }))
  const known = new Set(statuses.map(status => status.categoryId))
  const empty = categories.value
    .filter(category => category.active && !known.has(category.id))
    .map(category => ({ categoryId: category.id, name: category.name, accrued: 0, transferred: 0, spent: 0, byType: new Map<string, number>(), pending: 0, balance: 0 }))
  return [...statuses, ...empty].sort((first, second) => first.name.localeCompare(second.name))
})

const historyOf = (categoryId: string) =>
  movements.value.filter(movement => movement.categoryId === categoryId
    && (!range.value?.from || movement.date >= range.value.from) && (!range.value?.to || movement.date <= range.value.to))

function openModal(type: string, categoryId: string) {
  Object.assign(modal, { open: true, type, categoryId, amount: null, note: '', date: todayISO(), error: null })
}

async function submit() {
  modal.error = validateFundMovementInput(modal)
  if (modal.error || !modal.amount) return
  try {
    await taurus.repo.saveFundMovement({ date: modal.date, categoryId: modal.categoryId, type: modal.type, amount: modal.amount, note: modal.note.trim() || undefined })
    await load()
    modal.open = false
    show(`${typeName(modal.type)} registrado`)
  } catch (error) {
    modal.error = toUserMessage(error)
  }
}

async function remove(id: string) {
  try {
    await taurus.repo.deleteFundMovement(id)
    await load()
  } catch (error) {
    show(toUserMessage(error), 'error')
  }
}
</script>

<template>
  <section class="stack rise">
    <div class="seg range" :style="{ '--n': 2, '--i': rangeMode === 'month' ? 0 : 1 }" role="group" aria-label="Rango">
      <span class="thumb" />
      <button v-for="[modeKey, modeLabel] in RANGE_MODES" :key="modeKey" type="button" :class="{ active: rangeMode === modeKey }" @click="rangeMode = modeKey">{{ modeLabel }}</button>
    </div>

    <div v-if="!funds.length" class="card empty">
      <PiggyBank :size="40" />
      <b>Sin fondos todavía</b>
      <p class="small">Crea categorías de costo en Tarifas para llevar su fondo.</p>
    </div>

    <div class="fund-grid">
      <article v-for="fund in funds" :key="fund.categoryId" class="card stack fund" :data-fund="fund.categoryId">
        <div class="row between">
          <span class="row"><span class="icon-tile"><PiggyBank :size="20" /></span><b class="fund-name">{{ fund.name }}</b></span>
          <b class="num balance" :class="fund.balance < 0 ? 'neg' : 'pos'">{{ money(fund.balance) }}</b>
        </div>
        <div class="lines">
          <div><span>Por enviar</span><b class="num" :class="{ neg: fund.pending > 0 }">{{ money(fund.pending) }}</b></div>
          <div v-for="fundType in activeFundTypes" :key="fundType.id"><span>{{ fundType.name }}</span><b class="num">{{ money(fund.byType.get(fundType.id) ?? 0) }}</b></div>
          <div class="sep"><span>Saldo</span><b class="num" :class="fund.balance < 0 ? 'neg' : 'pos'">{{ money(fund.balance) }}</b></div>
        </div>
        <div class="row actions">
          <button v-for="fundType in activeFundTypes" :key="fundType.id" type="button" class="btn grow" @click="openModal(fundType.id, fund.categoryId)">
            <component :is="fundMovementIcon(fundType.id, fundType.sign)" :size="16" /> {{ modalTitle(fundType.id) }}
          </button>
        </div>
        <div class="stack history" style="gap: 8px">
          <span class="title">Historial</span>
          <p v-if="!historyOf(fund.categoryId).length" class="muted small">Sin movimientos en el rango.</p>
          <div v-for="movement in historyOf(fund.categoryId)" :key="movement.id" class="row mv">
            <span class="icon-tile" :class="signTone(typeSign(movement.type))">
              <component :is="fundMovementIcon(movement.type, typeSign(movement.type))" :size="18" />
            </span>
            <div class="grow">
              <b>{{ typeName(movement.type) }}</b>
              <p class="muted small"><CalendarDays :size="12" /> {{ movement.date }}<span v-if="movement.note"> · {{ movement.note }}</span></p>
            </div>
            <b class="num" :class="signTone(typeSign(movement.type))">{{ typeSign(movement.type) > 0 ? '+' : '−' }} {{ money(movement.amount) }}</b>
            <button type="button" class="btn icon ghost" aria-label="Eliminar movimiento" @click="remove(movement.id)"><Trash2 :size="17" /></button>
          </div>
        </div>
      </article>
    </div>

    <BaseModal :open="modal.open" :title="`${modalTitle(modal.type)} · ${categoryName(modal.categoryId)}`" @close="modal.open = false">
      <form class="stack" @submit.prevent="submit">
        <label class="field">
          <span>Monto</span>
          <input v-model.number="modal.amount" type="number" inputmode="decimal" min="0" placeholder="0" class="input" :aria-invalid="!!modal.error">
        </label>
        <label class="field">
          <span>Nota (opcional)</span>
          <input v-model="modal.note" type="text" class="input">
        </label>
        <label class="field">
          <span>Fecha</span>
          <input v-model="modal.date" type="date" class="input">
        </label>
        <p v-if="modal.error" class="err" role="alert">{{ modal.error }}</p>
        <button type="submit" class="btn primary block">{{ modalTitle(modal.type) }}</button>
      </form>
    </BaseModal>
  </section>
</template>

<style scoped>
.range { max-width: 320px; }
.fund-grid { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
@media (min-width: 1000px) { .fund-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1400px) { .fund-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.fund-name { font-size: 17px; }
.balance { font-size: 22px; font-weight: 800; white-space: nowrap; }
.lines { display: flex; flex-direction: column; gap: 8px; }
.lines > div { display: flex; justify-content: space-between; color: var(--text-2); }
.lines > .sep { padding-top: 8px; border-top: 1px solid var(--border); }
.actions { flex-wrap: wrap; }
.actions .btn { font-size: 13px; padding: 8px 10px; }
.history { max-height: 320px; overflow-y: auto; }
.mv { background: var(--surface-2); border-radius: 14px; padding: 10px; }
.err { color: var(--neg); font-size: 12px; font-weight: 600; }
</style>
