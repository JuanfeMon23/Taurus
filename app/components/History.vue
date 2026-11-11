<script setup lang="ts">
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, Inbox, Search, SearchX, Trash2 } from 'lucide-vue-next'
import type { DayRecord, ShiftTemplate } from '../services/types'
import { entryName } from '../utils/catalogs'
import { money } from '../utils/format'
import {
  HISTORY_COLUMNS, PAGE_SIZES, buildHistoryRows, filterHistoryRows, loadHistoryPreferences, paginateRows, saveHistoryPreferences,
  type HistoryColumnKey, type HistoryRow,
} from '../utils/historyTable'

const days = ref<DayRecord[]>([])
const templates = ref<ShiftTemplate[]>([])
const confirming = ref<string | null>(null)
const { show } = useNotify()
const { catalogs, defaultMethod, refreshCatalogs } = useCatalogs()

const initial = loadHistoryPreferences()
const pageSize = ref(initial.pageSize)
const visibleColumns = ref<HistoryColumnKey[]>(initial.columns)
const query = ref('')
const page = ref(1)
watch([pageSize, visibleColumns], () => saveHistoryPreferences({ pageSize: pageSize.value, columns: visibleColumns.value }), { deep: true })
watch([query, pageSize], () => { page.value = 1 })

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

async function load() {
  try {
    const taurus = await useTaurus()
    await refreshCatalogs()
    templates.value = await taurus.repo.listShiftTemplates({ includeInactive: true })
    days.value = await taurus.repo.listDays()
  } catch (error) {
    show(errorText(error, 'No se pudo cargar el historial'), 'error')
  }
}
onMounted(load)
onActivated(load)

// Borrar elimina el día completo (como antes): primer toque pide confirmar, el segundo borra.
async function remove(date: string) {
  if (confirming.value !== date) {
    confirming.value = date
    setTimeout(() => confirming.value === date && (confirming.value = null), 2500)
    return
  }
  try {
    await (await useTaurus()).repo.deleteDay(date)
    confirming.value = null
    show('Día eliminado')
    await load()
  } catch (error) {
    show(errorText(error, 'No se pudo eliminar'), 'error')
  }
}

const allRows = computed(() => buildHistoryRows(days.value, templates.value))
const filteredRows = computed(() => filterHistoryRows(allRows.value, query.value))
const pageData = computed(() => paginateRows(filteredRows.value, page.value, pageSize.value))
watch(() => pageData.value.page, current => { if (current !== page.value) page.value = current })

const columns = computed(() => HISTORY_COLUMNS.filter(column => visibleColumns.value.includes(column.key)))
const pageSizeLabel = (size: number) => (size === 0 ? 'Todos' : `${size} por página`)
const rangeText = computed(() => {
  const { total, page: current } = pageData.value
  if (!total) return '0 viajes'
  const size = pageSize.value || total
  return `${(current - 1) * size + 1}–${Math.min(current * size, total)} de ${total}`
})

function toggleColumn(key: HistoryColumnKey) {
  const next = visibleColumns.value.includes(key) ? visibleColumns.value.filter(candidate => candidate !== key) : [...visibleColumns.value, key]
  if (next.length) visibleColumns.value = next // siempre queda al menos una columna
}

const columnsMenu = ref<HTMLDetailsElement | null>(null)
function closeMenuOnOutsideClick(event: MouseEvent) {
  if (columnsMenu.value?.open && !columnsMenu.value.contains(event.target as Node)) columnsMenu.value.open = false
}
onMounted(() => document.addEventListener('click', closeMenuOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', closeMenuOnOutsideClick))

function cellText(row: HistoryRow, key: HistoryColumnKey): string {
  if (!row.tripId) return key === 'date' ? row.dayLabel : key === 'shift' ? 'Sin viajes' : ''
  switch (key) {
    case 'date': return row.dayLabel
    case 'shift': return row.shift
    case 'startTime': return row.startTime || '—'
    case 'endTime': return row.endTime || '—'
    case 'origin': return row.origin || '—'
    case 'destination': return row.destination || '—'
    case 'km': return row.km === null ? '—' : String(row.km)
    case 'amount': return money(row.amount)
    case 'bonus': return row.bonus > 0 ? money(row.bonus) : '—'
    case 'method': return entryName(catalogs.value.paymentMethods, row.method ?? defaultMethod.value) || '—'
    case 'commission': return !row.isIndrive ? 'Propio' : row.commission > 0 ? money(row.commission) : '—'
    case 'total': return money(row.total)
    case 'net': return money(row.net)
  }
}
</script>

<template>
  <section class="stack">
    <div v-if="!allRows.length" class="card empty">
      <Inbox :size="40" />
      <b>Aún no hay días registrados</b>
      <p class="small">Guarda tu primer día desde la pestaña Hoy.</p>
    </div>

    <div v-else class="card history">
      <div class="toolbar">
        <label class="input-icon search">
          <Search :size="18" />
          <input v-model="query" class="input" type="search" placeholder="Buscar por día u horario: 2026-11-05, 05/11, lunes, 14:, 2 pm…" aria-label="Buscar viajes por día u horario" data-history="search">
        </label>
        <div class="select">
          <select v-model.number="pageSize" class="input" aria-label="Viajes por página" data-history="page-size">
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ pageSizeLabel(size) }}</option>
          </select>
          <ChevronDown :size="18" />
        </div>
        <details ref="columnsMenu" class="columns" data-history="columns">
          <summary class="input"><Columns3 :size="18" /> Columnas ({{ visibleColumns.length }})<ChevronDown :size="18" class="chev" /></summary>
          <div class="menu card" role="group" aria-label="Columnas visibles">
            <label v-for="column in HISTORY_COLUMNS" :key="column.key" class="check">
              <input type="checkbox" :checked="visibleColumns.includes(column.key)" @change="toggleColumn(column.key)">
              <span>{{ column.label }}</span>
            </label>
          </div>
        </details>
      </div>

      <div v-if="pageData.items.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="column in columns" :key="column.key" :class="{ num: column.numeric }">{{ column.label }}</th>
              <th class="actions"><span class="sr-only">Eliminar día</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageData.items" :key="row.key" :class="{ doomed: confirming === row.date }">
              <td v-for="column in columns" :key="column.key" :class="[{ num: column.numeric, 'first-cap': column.key === 'date' }, column.key === 'net' && row.net < 0 ? 'neg' : '']">{{ cellText(row, column.key) }}</td>
              <td class="actions">
                <button class="btn icon ghost" :class="{ danger: confirming === row.date }" :title="confirming === row.date ? 'Toca otra vez para eliminar el día completo' : 'Eliminar el día completo'" :aria-label="confirming === row.date ? 'Confirmar eliminar día' : 'Eliminar día'" @click="remove(row.date)">
                  <Trash2 :size="16" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty small">
        <SearchX :size="32" />
        <b>Sin resultados</b>
        <p>Ningún viaje coincide con «{{ query }}».</p>
      </div>

      <div class="pager">
        <span class="muted small num">{{ rangeText }}</span>
        <div class="row" style="gap: 6px">
          <button class="btn icon" :disabled="pageData.page <= 1" aria-label="Página anterior" @click="page = pageData.page - 1"><ChevronLeft :size="18" /></button>
          <span class="small num">Página {{ pageData.page }} de {{ pageData.pageCount }}</span>
          <button class="btn icon" :disabled="pageData.page >= pageData.pageCount" aria-label="Página siguiente" @click="page = pageData.page + 1"><ChevronRight :size="18" /></button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.history { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.search { flex: 1 1 320px; }
.toolbar .select { width: 170px; }
.columns { position: relative; width: 200px; }
.columns > summary { display: flex; white-space: nowrap; align-items: center; gap: 8px; cursor: pointer; list-style: none; user-select: none; }
.columns > summary::-webkit-details-marker { display: none; }
.columns .chev { margin-left: auto; color: var(--muted); }
.columns .menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 260px; padding: 8px; display: flex; flex-direction: column; gap: 2px; max-height: 360px; overflow-y: auto; }
.check { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 14px; }
.check:hover { background: var(--surface-2); }
.check input { accent-color: var(--accent); width: 16px; height: 16px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.neg { color: var(--neg); }
td.first-cap::first-letter { text-transform: uppercase; }
th.actions, td.actions { width: 44px; text-align: right; padding: 3px 6px; }
tbody tr { transition: background 0.2s; }
tbody tr:hover { background: var(--surface-2); }
tbody tr.doomed { background: var(--neg-soft); }
.btn.icon { padding: 7px; }
.btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
.danger { background: var(--neg-soft); }
.pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
