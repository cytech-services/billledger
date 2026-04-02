<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import BillModal from '~/components/BillModal.vue'
import { useConfirm } from '~/composables/useConfirm'

type Bill = {
  id: number
  name: string
  company?: string
  frequency: string
  due_day?: number | null
  next_date?: string | null
  amount?: number | null
  autopay?: 'Yes' | 'No'
  method?: string | null
  account?: string | null
  notes?: string | null
}

const api = useApi()
const { confirm } = useConfirm()
const bills = ref<Bill[]>([])
const loading = ref(false)
const err = ref<string | null>(null)
const modalOpen = ref(false)
const editing = ref<Bill | null>(null)

async function load() {
  loading.value = true
  err.value = null
  try {
    bills.value = await api.get<Bill[]>('/api/bills')
  } catch (e: any) {
    err.value = e?.message || 'Failed to load bills'
  } finally {
    loading.value = false
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dueText(b: Bill) {
  if (b.frequency === 'Monthly' && b.due_day) return `Day ${b.due_day}`
  if (b.frequency === 'Weekly' && b.due_day != null) return `Weekday ${b.due_day}`
  if (b.frequency === 'Estimated Tax (US/NY)') return 'Jan 15, Apr 15, Jun 15, Sep 15'
  if (b.frequency === 'Custom') return 'Custom dates'
  if (b.next_date) return fmtDate(b.next_date)
  return '—'
}

function openAdd() {
  editing.value = {
    name: '',
    company: '',
    frequency: '',
    due_day: null,
    next_date: null,
    amount: null,
    autopay: 'No',
    method: '',
    account: '',
    notes: '',
  }
  modalOpen.value = true
}

function openEdit(b: Bill) {
  editing.value = { ...b }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  editing.value = null
}

async function deleteBill(id: number) {
  const ok = await confirm({
    title: 'Delete bill?',
    message: 'Delete this bill and all its payment history?',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await api.del(`/api/bills/${id}`)
    await load()
  } catch (e: any) {
    err.value = e?.message || 'Failed to delete bill'
  }
}

onMounted(load)
</script>

<template>
  <div class="page active">
    <div class="mb-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-center justify-between">
      <h2 class="font-['DM_Serif_Display'] text-[2rem]">My Bills</h2>
      <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)]" @click="openAdd()">+ Add Bill</button>
    </div>

    <div v-if="err" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">{{ err }}</div>
    <div v-else-if="loading" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">Loading…</div>
    <div v-else-if="!bills.length" class="block px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(50px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[color:var(--ink-light)]">
      <div class="mb-[14px] text-[4.4rem]">📋</div>
      <h3 class="mb-[7px] font-['DM_Serif_Display'] text-[1.9rem] text-[color:var(--ink)]">No bills yet</h3>
      <p class="mb-[18px] text-[1.3rem]">Add each of your bills once and let Bill Ledger track everything.</p>
      <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)]" @click="openAdd()">+ Add Your First Bill</button>
    </div>
    <div v-else class="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Bill Name</th>
            <th>Company</th>
            <th>Frequency</th>
            <th>Due</th>
            <th>Amount</th>
            <th>Auto-Pay</th>
            <th>Method</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bills" :key="b.id">
            <td><strong class="cursor-pointer text-[1.4rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline">{{ b.name }}</strong></td>
            <td class="text-[color:var(--ink-light)]">{{ b.company || '—' }}</td>
            <td>{{ b.frequency }}</td>
            <td class="text-[color:var(--ink-light)]">{{ dueText(b) }}</td>
            <td>{{ b.amount != null ? '$' + Number(b.amount).toFixed(2) : '—' }}</td>
            <td>{{ b.autopay === 'Yes' ? '✅ Yes' : 'No' }}</td>
            <td class="text-[color:var(--ink-light)]">{{ b.method || '—' }}</td>
            <td class="max-w-[calc(140px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden text-ellipsis whitespace-nowrap text-[color:var(--ink-light)]">
              {{ b.notes || '—' }}
            </td>
            <td>
              <div class="flex gap-[calc(7px*var(--layout-scale-n)/var(--layout-scale-d))]">
                <button class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="openEdit(b)">Edit</button>
                <button class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="deleteBill(b.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <BillModal :open="modalOpen" :bill="editing" @close="closeModal()" @saved="load()" />
</template>

