<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import { useRuntimeConfig } from '#imports'
import { useConfirm } from '~/composables/useConfirm'

const api = useApi()
const { confirm } = useConfirm()
const tab = ref<'methods' | 'backups'>('methods')

const paymentMethods = ref<string[]>([])
const methodStats = ref<Record<string, { bill_count: number; payment_count: number; total_paid: number }>>({})
const newMethod = ref('')
const settingsErr = ref<string | null>(null)

const backups = ref<Array<{ filename: string; size: number; created_at: string; reason: string }>>([])
const backupStatus = ref<any>(null)
const backingUp = ref(false)

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function loadMethods() {
  paymentMethods.value = await api.get<string[]>('/api/payment-methods')
  const rows = await api.get<any[]>('/api/payment-methods/stats')
  const map: any = {}
  for (const r of rows) map[String(r.name || '').toLowerCase()] = r
  methodStats.value = map
}

async function loadBackups() {
  const [b, s] = await Promise.all([api.get<any[]>('/api/backups'), api.get<any>('/api/backups/status')])
  backups.value = b
  backupStatus.value = s
}

async function addMethod() {
  const name = newMethod.value.trim()
  if (!name) return
  settingsErr.value = null
  await api.post('/api/payment-methods', { name })
  newMethod.value = ''
  await loadMethods()
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
    await loadMethods()
  } catch (e: any) {
    try {
      const details = JSON.parse(e?.message || '{}')
      if (details?.requires_replacement) {
        await replaceAndDelete(name, details)
        return
      }
      settingsErr.value = details?.error || e?.message || 'Failed to remove method'
    } catch {
      settingsErr.value = e?.message || 'Failed to remove method'
    }
  }
}

async function replaceAndDelete(oldName: string, details: any) {
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
  await loadMethods()
}

async function runManualBackup() {
  backingUp.value = true
  settingsErr.value = null
  try {
    await api.post('/api/backups')
    await loadBackups()
  } catch (e: any) {
    settingsErr.value = e?.message || 'Backup failed'
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
    await Promise.all([loadBackups(), loadMethods()])
  } catch (e: any) {
    settingsErr.value = e?.message || 'Restore failed'
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
    <div class="sec-hdr"><h2>Settings</h2></div>
    <div v-if="settingsErr" class="none-msg">{{ settingsErr }}</div>
    <div class="settings-wrap">
      <div class="settings-side">
        <button :class="{ active: tab === 'methods' }" @click="tab = 'methods'">Payment Methods</button>
        <button :class="{ active: tab === 'backups' }" @click="tab = 'backups'">Backups</button>
      </div>
      <div class="settings-content">
        <div v-if="tab === 'methods'">
          <div class="sec-title">Payment Methods</div>
          <div class="settings-method-form">
            <div class="fg">
              <label>New method</label>
              <input v-model="newMethod" placeholder="e.g. Chase Visa" @keydown.enter.prevent="addMethod()" />
            </div>
            <button class="btn btn-primary" @click="addMethod()">Add</button>
          </div>
          <div v-if="!methodsSorted.length" class="none-msg">No payment methods saved yet.</div>
          <div v-else class="method-list">
            <div v-for="m in methodsSorted" :key="m" class="method-row">
              <div>
                <div class="method-name">{{ m }}</div>
                <div class="method-meta">
                  {{ getStats(m).bill_count }} bill{{ getStats(m).bill_count === 1 ? '' : 's' }} used ·
                  {{ fmtMoney(getStats(m).total_paid) }} total paid
                </div>
              </div>
              <button class="btn btn-danger btn-sm" @click="removeMethod(m)">Remove</button>
            </div>
          </div>
        </div>

        <div v-else>
          <div class="sec-title">Backups</div>
          <div v-if="backupStatus" class="none-msg" style="text-align: left">
            Retention: {{ backupStatus.retention_days }} days · Total: {{ backupStatus.total_backups }}
          </div>
          <button class="btn btn-primary" style="margin-bottom:12px" :disabled="backingUp" @click="runManualBackup()">
            <span v-if="backingUp" class="spinner"></span>
            <span v-else>Run Manual Backup</span>
          </button>
          <div v-if="!backups.length" class="none-msg">No backups found yet.</div>
          <div v-else class="method-list">
            <div v-for="b in backups" :key="b.filename" class="method-row">
              <div>
                <div class="method-name">{{ b.filename }}</div>
                <div class="method-meta">{{ new Date(b.created_at).toLocaleString() }} · {{ b.size }} bytes</div>
              </div>
              <div class="backup-actions">
                <button class="btn btn-ghost btn-sm" @click="downloadBackup(b.filename)">Download</button>
                <button class="btn btn-danger btn-sm" @click="restoreBackup(b.filename)">Restore</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

