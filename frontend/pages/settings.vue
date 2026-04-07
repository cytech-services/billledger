<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import { useRuntimeConfig } from '#imports'
import { useConfirm } from '~/composables/useConfirm'
import { getErrorMessage } from '~/utils/error'

const api = useApi()
const { confirm } = useConfirm()
const tab = ref<'methods' | 'backups'>('methods')
type MethodStat = { name: string; bill_count: number; payment_count: number; total_paid: number }
type BackupStatus = { retention_days: number; backup_dir: string; total_backups: number; last_automatic_backup: unknown | null }
type MethodDeleteDetails = { requires_replacement?: boolean; error?: string; payment_count?: number }

const paymentMethods = ref<string[]>([])
const methodStats = ref<Record<string, { bill_count: number; payment_count: number; total_paid: number }>>({})
const newMethod = ref('')
const settingsErr = ref<string | null>(null)

const backups = ref<Array<{ filename: string; size: number; created_at: string; reason: string }>>([])
const backupStatus = ref<BackupStatus | null>(null)
const backingUp = ref(false)

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function loadMethods() {
  paymentMethods.value = await api.get<string[]>('/api/payment-methods')
  const rows = await api.get<MethodStat[]>('/api/payment-methods/stats')
  const map: Record<string, MethodStat> = {}
  for (const r of rows) map[String(r.name || '').toLowerCase()] = r
  methodStats.value = map
}

async function loadBackups() {
  const [b, s] = await Promise.all([
    api.get<Array<{ filename: string; size: number; created_at: string; reason: string }>>('/api/backups'),
    api.get<BackupStatus>('/api/backups/status')
  ])
  backups.value = b
  backupStatus.value = s
}

async function refreshWithScroll(task: () => Promise<void>) {
  const scrollY = window.scrollY
  await task()
  await nextTick()
  window.scrollTo({ top: scrollY, behavior: 'auto' })
}

async function addMethod() {
  const name = newMethod.value.trim()
  if (!name) return
  settingsErr.value = null
  await api.post('/api/payment-methods', { name })
  newMethod.value = ''
  await refreshWithScroll(loadMethods)
}

async function removeMethod(name: string) {
  const ok = await confirm({
    title: 'Remove payment method?',
    message: `Remove "${name}" from saved methods?`,
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  settingsErr.value = null
  try {
    await api.del(`/api/payment-methods/${encodeURIComponent(name)}`)
    await refreshWithScroll(loadMethods)
  } catch (e: unknown) {
    try {
      const details = JSON.parse(getErrorMessage(e, '{}')) as MethodDeleteDetails
      if (details?.requires_replacement) {
        await replaceAndDelete(name, details)
        return
      }
      settingsErr.value = details?.error || getErrorMessage(e, 'Failed to remove method')
    } catch {
      settingsErr.value = getErrorMessage(e, 'Failed to remove method')
    }
  }
}

async function replaceAndDelete(oldName: string, details: MethodDeleteDetails) {
  const choices = methodsSorted.value.filter((m) => m.toLowerCase() !== oldName.toLowerCase())
  if (!choices.length) {
    settingsErr.value = 'Add another method first, then replace and delete.'
    return
  }
  const replacement = (prompt(
    `"${oldName}" is used by ${details?.payment_count || 0} payment(s). Enter a replacement method to apply before deleting.`,
    choices[0]
  ) || '').trim()
  if (!replacement) return
  if (replacement.toLowerCase() === oldName.toLowerCase()) {
    settingsErr.value = 'Replacement method must be different.'
    return
  }
  await api.post('/api/payment-methods', { name: replacement })
  await api.post('/api/payment-methods/replace', { from: oldName, to: replacement, replace_bill_defaults: true })
  await api.del(`/api/payment-methods/${encodeURIComponent(oldName)}`)
  await refreshWithScroll(loadMethods)
}

async function runManualBackup() {
  backingUp.value = true
  settingsErr.value = null
  try {
    await api.post('/api/backups')
    await refreshWithScroll(loadBackups)
  } catch (e: unknown) {
    settingsErr.value = getErrorMessage(e, 'Backup failed')
  } finally {
    backingUp.value = false
  }
}

function downloadBackup(filename: string) {
  const base = (useRuntimeConfig().public.apiBase as string) || 'http://127.0.0.1:3001'
  window.open(`${base.replace(/\/$/, '')}/api/backups/${encodeURIComponent(filename)}/download`, '_blank')
}

async function restoreBackup(filename: string) {
  const ok = await confirm({
    title: 'Restore backup?',
    message: `Restore backup "${filename}"?\n\nThis will replace the current database and cannot be undone except by another backup.`,
    confirmText: 'Restore',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  settingsErr.value = null
  try {
    await api.post('/api/backups/restore', { filename })
    await refreshWithScroll(async () => {
      await Promise.all([loadBackups(), loadMethods()])
    })
  } catch (e: unknown) {
    settingsErr.value = getErrorMessage(e, 'Restore failed')
  }
}

const methodsSorted = computed(() => [...paymentMethods.value].sort((a, b) => a.localeCompare(b)))
function getStats(name: string) {
  return methodStats.value[String(name || '').toLowerCase()] || { bill_count: 0, payment_count: 0, total_paid: 0 }
}

onMounted(async () => {
  await Promise.all([loadMethods(), loadBackups()])
})
</script>

<template>
  <div class="page active" id="pg-settings">
    <div class="mb-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-center justify-between">
      <h2 class="font-['DM_Serif_Display'] text-[2rem]">Settings</h2>
    </div>
    <div v-if="settingsErr" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">{{ settingsErr }}</div>
    <div class="grid grid-cols-[calc(220px*var(--layout-scale-n)/var(--layout-scale-d))_1fr] gap-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
      <div class="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] p-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button
          class="w-full rounded-lg px-3 py-[10px] text-left text-[1.3rem] font-semibold transition-all"
          :class="tab === 'methods' ? 'bg-[color:var(--accent-light)] text-[color:var(--accent-dark)]' : 'text-[color:var(--ink-light)] hover:bg-[color:var(--paper-dark)] hover:text-[color:var(--ink)]'"
          @click="tab = 'methods'"
        >Payment Methods</button>
        <button
          class="mt-1 w-full rounded-lg px-3 py-[10px] text-left text-[1.3rem] font-semibold transition-all"
          :class="tab === 'backups' ? 'bg-[color:var(--accent-light)] text-[color:var(--accent-dark)]' : 'text-[color:var(--ink-light)] hover:bg-[color:var(--paper-dark)] hover:text-[color:var(--ink)]'"
          @click="tab = 'backups'"
        >Backups</button>
      </div>
      <div class="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] p-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div v-if="tab === 'methods'">
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">Payment Methods</div>
          <div class="mb-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-end gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div class="flex-1">
              <label>New method</label>
              <input v-model="newMethod" placeholder="e.g. Chase Visa" @keydown.enter.prevent="addMethod()" />
            </div>
            <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)]" @click="addMethod()">Add</button>
          </div>
          <div v-if="!methodsSorted.length" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">No payment methods saved yet.</div>
          <div v-else class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div
              v-for="m in methodsSorted"
              :key="m"
              class="flex items-center justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--paper)] px-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))]"
            >
              <div>
                <div class="text-[1.4rem] font-semibold text-[color:var(--ink)]">{{ m }}</div>
                <div class="mt-[3px] text-[1.2rem] text-[color:var(--ink-light)]">
                  {{ getStats(m).bill_count }} bill{{ getStats(m).bill_count === 1 ? '' : 's' }} used ·
                  {{ fmtMoney(getStats(m).total_paid) }} total paid
                </div>
              </div>
              <button class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="removeMethod(m)">Remove</button>
            </div>
          </div>
        </div>

        <div v-else>
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">Backups</div>
          <div v-if="backupStatus" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-left text-[1.3rem] italic text-[color:var(--ink-light)]">
            Retention: {{ backupStatus.retention_days }} days · Total: {{ backupStatus.total_backups }}
          </div>
          <button class="mb-3 rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)] disabled:opacity-60" :disabled="backingUp" @click="runManualBackup()">
            <span v-if="backingUp" class="spinner"></span>
            <span v-else>Run Manual Backup</span>
          </button>
          <div v-if="!backups.length" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">No backups found yet.</div>
          <div v-else class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div
              v-for="b in backups"
              :key="b.filename"
              class="flex items-center justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--paper)] px-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))]"
            >
              <div>
                <div class="text-[1.4rem] font-semibold text-[color:var(--ink)]">{{ b.filename }}</div>
                <div class="mt-[3px] text-[1.2rem] text-[color:var(--ink-light)]">{{ new Date(b.created_at).toLocaleString() }} · {{ b.size }} bytes</div>
              </div>
              <div class="flex gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
                <button class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="downloadBackup(b.filename)">Download</button>
                <button class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="restoreBackup(b.filename)">Restore</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

