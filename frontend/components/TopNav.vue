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
</script>

<template>
  <header>
    <div class="logo">Bill<span>·</span>Ledger</div>
    <nav class="page-nav">
      <NuxtLink to="/" custom v-slot="{ navigate }">
        <button :class="{ active: active === 'dashboard' }" data-page="dashboard" @click="navigate()">Dashboard</button>
      </NuxtLink>
      <NuxtLink to="/bills" custom v-slot="{ navigate }">
        <button :class="{ active: active === 'bills' }" data-page="bills" @click="navigate()">My Bills</button>
      </NuxtLink>
      <NuxtLink to="/yearview" custom v-slot="{ navigate }">
        <button :class="{ active: active === 'yearview' }" data-page="yearview" @click="navigate()">Year View</button>
      </NuxtLink>
      <NuxtLink to="/log" custom v-slot="{ navigate }">
        <button :class="{ active: active === 'log' }" data-page="log" @click="navigate()">Payment Log</button>
      </NuxtLink>
      <NuxtLink to="/settings" custom v-slot="{ navigate }">
        <button :class="{ active: active === 'settings' }" data-page="settings" @click="navigate()">Settings</button>
      </NuxtLink>
    </nav>
    <div class="theme-switch-wrap">
      <label for="theme-select" class="theme-switch-label">Theme</label>
      <select
        id="theme-select"
        class="theme-switch"
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

