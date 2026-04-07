<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '~/composables/useTheme'

const route = useRoute()
const { preference, setPreference } = useTheme()
const logoHeaderSrc = '/logo-header.svg'

const active = computed(() => {
  if (route.path.startsWith('/bills')) return 'bills'
  if (route.path.startsWith('/yearview')) return 'yearview'
  if (route.path.startsWith('/log')) return 'log'
  if (route.path.startsWith('/settings')) return 'settings'
  return 'dashboard'
})

function navBtnClass(name: string) {
  const base =
    'rounded-[7px] px-[15px] py-[7px] text-[1.3rem] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white'
  const on = 'bg-[color:var(--accent)] text-white'
  return active.value === name ? `${base} ${on}` : base
}
</script>

<template>
  <header class="sticky top-0 z-[100] flex h-[60px] items-center justify-between bg-[color:var(--header-bg)] px-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_2px_12px_rgba(0,0,0,.25)]">
    <div class="flex items-center">
      <img :src="logoHeaderSrc" alt="BillLedger" class="h-[38px] w-auto" />
    </div>
    <nav class="flex gap-[3px]">
      <NuxtLink to="/" custom v-slot="{ navigate }">
        <button :class="navBtnClass('dashboard')" data-page="dashboard" @click="navigate()">Dashboard</button>
      </NuxtLink>
      <NuxtLink to="/bills" custom v-slot="{ navigate }">
        <button :class="navBtnClass('bills')" data-page="bills" @click="navigate()">My Bills</button>
      </NuxtLink>
      <NuxtLink to="/yearview" custom v-slot="{ navigate }">
        <button :class="navBtnClass('yearview')" data-page="yearview" @click="navigate()">Year View</button>
      </NuxtLink>
      <NuxtLink to="/log" custom v-slot="{ navigate }">
        <button :class="navBtnClass('log')" data-page="log" @click="navigate()">Payment History</button>
      </NuxtLink>
      <NuxtLink to="/settings" custom v-slot="{ navigate }">
        <button :class="navBtnClass('settings')" data-page="settings" @click="navigate()">Settings</button>
      </NuxtLink>
    </nav>
    <div class="flex items-center gap-2">
      <label for="theme-select" class="text-[1.1rem] font-bold uppercase tracking-[.4px] text-white/70">Theme</label>
      <div class="relative">
        <select
          id="theme-select"
          class="min-w-[108px] cursor-pointer rounded-[7px] border border-[color:var(--border)] bg-[color:var(--paper)] py-[6px] pl-[10px] pr-[30px] text-[1.2rem] text-[color:var(--ink)] shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/25 [appearance:none] [-webkit-appearance:none] [-moz-appearance:none]"
          :value="preference"
          @change="setPreference(($event.target as HTMLSelectElement).value)"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <svg
          class="pointer-events-none absolute right-[10px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 text-[color:var(--ink-light)]"
          viewBox="0 0 10 6"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>
  </header>
</template>

