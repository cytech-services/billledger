<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from '~/composables/useTheme'

const route = useRoute()
const { preference, setPreference } = useTheme()

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
    <div class="flex items-center gap-2 font-['DM_Serif_Display'] text-[2rem] text-white">Bill<span class="text-[color:var(--accent)]">·</span>Ledger</div>
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
        <button :class="navBtnClass('log')" data-page="log" @click="navigate()">Payment Log</button>
      </NuxtLink>
      <NuxtLink to="/settings" custom v-slot="{ navigate }">
        <button :class="navBtnClass('settings')" data-page="settings" @click="navigate()">Settings</button>
      </NuxtLink>
    </nav>
    <div class="flex items-center gap-2">
      <label for="theme-select" class="text-[1.1rem] font-bold uppercase tracking-[.4px] text-white/70">Theme</label>
      <select
        id="theme-select"
        class="min-w-[88px] cursor-pointer rounded-[7px] border border-white/20 bg-white/10 px-[10px] py-[6px] text-[1.2rem] text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        :value="preference"
        @change="setPreference(($event.target as HTMLSelectElement).value)"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  </header>
</template>

