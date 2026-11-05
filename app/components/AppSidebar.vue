<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import type { Component } from 'vue'

export interface NavItem { key: string; label: string; icon: Component }

defineProps<{ items: readonly NavItem[]; active: string }>()
const collapsed = defineModel<boolean>('collapsed', { default: false })
defineEmits<{ select: [key: string] }>()
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="brand">
      <svg class="logo" viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="120" fill="url(#sg)" />
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffb020" /><stop offset="1" stop-color="#ff7a18" />
          </linearGradient>
        </defs>
        <path d="M120 150c0 56 40 92 76 98v52c-62 8-100 52-100 108h40c0-40 30-64 68-64h104c38 0 68 24 68 64h40c0-56-38-100-100-108v-52c36-6 76-42 76-98h-40c0 40-28 64-64 64h-64c-36 0-64-24-64-64z" fill="#1a1203" />
      </svg>
      <span v-if="!collapsed" class="brand-name">Taurus</span>
    </div>

    <nav aria-label="Secciones" class="items">
      <button
        v-for="it in items" :key="it.key" type="button" class="item"
        :class="{ active: it.key === active }" :title="collapsed ? it.label : undefined"
        :aria-label="it.label" :aria-current="it.key === active ? 'page' : undefined"
        @click="$emit('select', it.key)"
      >
        <component :is="it.icon" :size="20" :stroke-width="it.key === active ? 2.4 : 1.9" />
        <span v-if="!collapsed">{{ it.label }}</span>
      </button>
    </nav>

    <button type="button" class="item toggle" :aria-label="collapsed ? 'Expandir menú' : 'Contraer menú'" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
      <component :is="collapsed ? PanelLeftOpen : PanelLeftClose" :size="20" />
      <span v-if="!collapsed">Contraer</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  position: fixed; z-index: 20; top: 0; bottom: 0; left: 0;
  width: var(--sidebar-w, 232px);
  display: flex; flex-direction: column; gap: 18px;
  padding: 18px 12px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  transition: width 0.25s var(--ease);
}
.brand { display: flex; align-items: center; gap: 12px; padding: 0 6px; min-height: 42px; }
.logo { width: 38px; height: 38px; flex-shrink: 0; filter: drop-shadow(0 6px 14px rgba(255, 140, 20, 0.35)); }
.brand-name { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.items { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px; border-radius: var(--radius-sm);
  color: var(--text-2); font-weight: 600; text-align: left;
  transition: background 0.2s, color 0.2s;
}
.item:hover { background: var(--surface-2); color: var(--text); }
.item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.item.active { background: var(--accent-soft); color: var(--accent); }
.collapsed .item { justify-content: center; padding-inline: 0; }
.collapsed .brand { justify-content: center; padding: 0; }
.toggle { color: var(--muted); }
</style>
