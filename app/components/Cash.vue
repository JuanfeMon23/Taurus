<script setup lang="ts">
import { CalendarDays } from 'lucide-vue-next'
import { todayISO } from '../utils/format'

const date = ref(todayISO())
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
    <CashPanel :date="date" />
  </section>
</template>
