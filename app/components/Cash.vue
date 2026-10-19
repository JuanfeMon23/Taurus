<script setup lang="ts">
import { ArrowLeftRight, ArrowUpCircle, Banknote, CalendarDays, HandCoins, Lock, LockOpen, PiggyBank, Plus, Scale, Trash2, Wallet } from 'lucide-vue-next'
import type { CashDay, DayRecord, MovementType } from '../services/types'
import { cashSummary } from '../utils/cash'
import { money, todayISO } from '../utils/format'

const date = ref(todayISO())
const day = ref<DayRecord | null>(null)
const cash = ref<CashDay | null>(null)
const opening = ref<number | null>(null)
const counted = ref<number | null>(null)
const mv = reactive({ type: 'expense' as MovementType, amount: null as number | null, note: '' })
const { show } = useToast()
let taurus: Awaited<ReturnType<typeof useTaurus>>

const TYPES = {
  expense: { label: 'Gasto', icon: ArrowUpCircle, tone: 'neg' },
  withdrawal: { label: 'Retiro', icon: HandCoins, tone: 'neg' },
  deposit: { label: 'Aporte', icon: PiggyBank, tone: 'pos' },
} as const

const summary = computed(() => cashSummary(day.value, cash.value))
const isOpen = computed(() => !!cash.value && !cash.value.closedAt)

async function load() {
  day.value = await taurus.repo.getDay(date.value)
  cash.value = await taurus.repo.getCash(date.value)
  counted.value = cash.value?.counted ?? null
}
onMounted(async () => {
  taurus = await useTaurus()
  await load()
})
onActivated(() => taurus && load())
watch(date, () => taurus && load())

async function save(c: CashDay, msg?: string) {
  await taurus.repo.putCash(c)
  await load()
  if (msg) show(msg)
}
const open = () => save({ date: date.value, opening: opening.value ?? 0, openedAt: new Date().toISOString(), movements: [] }, 'Caja abierta')
const reopen = () => cash.value && save({ ...cash.value, closedAt: undefined, counted: undefined }, 'Caja reabierta')
const close = () => cash.value && save({ ...cash.value, closedAt: new Date().toISOString(), counted: counted.value ?? undefined }, 'Caja cerrada')

async function addMovement() {
  if (!cash.value || !mv.amount) return
  // id vacío: el dominio asigna un id único al guardarlo.
  await save({ ...cash.value, movements: [...cash.value.movements, { id: '', type: mv.type, amount: mv.amount, note: mv.note || undefined }] }, `${TYPES[mv.type].label} registrado`)
  Object.assign(mv, { amount: null, note: '' })
}
const removeMovement = (id: string) =>
  cash.value && save({ ...cash.value, movements: cash.value.movements.filter(m => m.id !== id) })
</script>

<template>
  <section class="stack rise">
    <div class="card">
      <label class="field">
        <span>Fecha</span>
        <div class="input-icon">
          <CalendarDays :size="18" />
          <input v-model="date" type="date" class="input">
        </div>
      </label>
    </div>

    <!-- Sin abrir -->
    <div v-if="!cash" class="card stack">
      <div class="empty">
        <span class="icon-tile big"><Wallet :size="28" /></span>
        <b>Caja sin abrir</b>
        <p class="small">Registra el efectivo con el que empiezas el día.</p>
      </div>
      <label class="field">
        <span>Efectivo de apertura</span>
        <div class="input-icon">
          <Banknote :size="18" />
          <input v-model.number="opening" type="number" inputmode="decimal" placeholder="0" class="input">
        </div>
      </label>
      <button class="btn primary block" @click="open"><LockOpen :size="18" /> Abrir caja</button>
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
          <div><span class="pos">+ Servicios en efectivo</span><b class="num">{{ money(summary.cashIncome) }}</b></div>
          <div v-if="summary.deposits"><span class="pos">+ Aportes</span><b class="num">{{ money(summary.deposits) }}</b></div>
          <div><span class="neg">− Gastos</span><b class="num">{{ money(summary.expenses) }}</b></div>
          <div><span class="neg">− Retiros</span><b class="num">{{ money(summary.withdrawals) }}</b></div>
        </div>
        <div v-if="summary.transferIncome" class="note">
          <ArrowLeftRight :size="16" /> {{ money(summary.transferIncome) }} por transferencia (no entran a caja)
        </div>
      </div>

      <template v-if="isOpen">
        <!-- Movimientos -->
        <div class="card stack">
          <span class="title">Nuevo movimiento</span>
          <div class="seg" :style="{ '--n': 3, '--i': ['expense', 'withdrawal', 'deposit'].indexOf(mv.type) }">
            <span class="thumb" />
            <button v-for="(t, k) in TYPES" :key="k" :class="{ active: mv.type === k }" @click="mv.type = k">{{ t.label }}</button>
          </div>
          <input v-model.number="mv.amount" type="number" inputmode="decimal" placeholder="Monto" class="input">
          <input v-model="mv.note" type="text" placeholder="Nota (opcional)" class="input">
          <button class="btn block" @click="addMovement"><Plus :size="18" /> Agregar</button>

          <TransitionGroup name="list" tag="div" class="stack rel" style="gap: 8px">
            <div v-for="m in cash.movements" :key="m.id" class="row mv">
              <span class="icon-tile" :class="TYPES[m.type].tone"><component :is="TYPES[m.type].icon" :size="20" /></span>
              <div class="grow">
                <b>{{ TYPES[m.type].label }}</b>
                <p v-if="m.note" class="muted small">{{ m.note }}</p>
              </div>
              <b class="num" :class="TYPES[m.type].tone">{{ TYPES[m.type].tone === 'neg' ? '−' : '+' }} {{ money(m.amount) }}</b>
              <button class="btn icon ghost" aria-label="Eliminar" @click="removeMovement(m.id)"><Trash2 :size="17" /></button>
            </div>
          </TransitionGroup>
        </div>

        <!-- Cierre -->
        <div class="card stack">
          <span class="title">Cierre</span>
          <label class="field">
            <span>Efectivo contado (opcional)</span>
            <div class="input-icon">
              <Scale :size="18" />
              <input v-model.number="counted" type="number" inputmode="decimal" placeholder="0" class="input">
            </div>
          </label>
          <button class="btn primary block" @click="close"><Lock :size="18" /> Cerrar caja</button>
        </div>
      </template>

      <div v-else class="card stack">
        <div class="lines">
          <div><span>Contado</span><b class="num">{{ summary.counted === undefined ? '—' : money(summary.counted) }}</b></div>
          <div v-if="summary.difference !== undefined">
            <span>{{ summary.difference < 0 ? 'Faltante' : summary.difference > 0 ? 'Sobrante' : 'Cuadra' }}</span>
            <b class="num" :class="summary.difference < 0 ? 'neg' : 'pos'">{{ money(Math.abs(summary.difference)) }}</b>
          </div>
        </div>
        <button class="btn block" @click="reopen"><LockOpen :size="18" /> Reabrir caja</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rel { position: relative; }
.big { width: 64px; height: 64px; border-radius: 20px; }
.total { font-size: 42px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.lines { display: flex; flex-direction: column; gap: 8px; }
.lines > div { display: flex; justify-content: space-between; color: var(--text-2); }
.note { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--info-soft); color: var(--info); font-size: 13px; font-weight: 600; }
.mv { background: var(--surface-2); border-radius: 14px; padding: 10px; }
</style>
