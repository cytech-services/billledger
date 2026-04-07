<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import BillModal from '~/components/BillModal.vue'
import BillDetailModal from '~/components/BillDetailModal.vue'
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
  month_day_combinations?: string[] | null
}

const api = useApi()
const { confirm } = useConfirm()
const bills = ref<Bill[]>([])
const loading = ref(false)
const err = ref<string | null>(null)
const modalOpen = ref(false)
const editing = ref<Bill | null>(null)
const detailOpen = ref(false)
const detailBillId = ref<number | null>(null)

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback
}

async function load(options?: { silent?: boolean; preserveScroll?: boolean }) {
  const silent = options?.silent === true
  const preserveScroll = options?.preserveScroll === true
  const scrollY = preserveScroll ? window.scrollY : 0
  if (!silent) loading.value = true
  err.value = null
  try {
    bills.value = await api.get<Bill[]>('/api/bills')
  } catch (e: unknown) {
    err.value = errorMessage(e, 'Failed to load bills')
  } finally {
    if (!silent) loading.value = false
    if (preserveScroll) {
      await nextTick()
      window.scrollTo({ top: scrollY, behavior: 'auto' })
    }
  }
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dueText(b: Bill) {
  if (b.frequency === 'Yearly (Month/Day)') {
    const combos = Array.isArray(b.month_day_combinations) ? b.month_day_combinations : []
    if (!combos.length) return '—'
    return combos
      .map((md) => {
        const m = /^(\d{2})-(\d{2})$/.exec(String(md || '').trim())
        if (!m) return String(md || '')
        const month = Number(m[1])
        const day = Number(m[2])
        if (month < 1 || month > 12 || day < 1 || day > 31) return String(md || '')
        return `${new Date(2000, month - 1, 1).toLocaleDateString('en-US', { month: 'short' })} ${day}`
      })
      .filter(Boolean)
      .join(', ')
  }
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

function openDetail(billId: number) {
  detailBillId.value = billId
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailBillId.value = null
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
    await load({ silent: true, preserveScroll: true })
  } catch (e: unknown) {
    err.value = errorMessage(e, 'Failed to delete bill')
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
    <div v-else class="overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] shadow-[0_2px_10px_var(--shadow)]">
      <table class="min-w-[1080px]">
        <thead>
          <tr>
            <th>Bill Name</th>
            <th>Frequency</th>
            <th>Due</th>
            <th class="text-right">Amount</th>
            <th>Method</th>
            <th>Notes</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in bills" :key="b.id" class="align-top">
            <td>
              <strong class="cursor-pointer text-[1.45rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline" @click="openDetail(b.id)">{{ b.name }}</strong>
              <div class="mt-0.5 text-[1.15rem] text-[color:var(--ink-light)]">{{ b.company || '—' }}</div>
            </td>
            <td>
              <span class="inline-flex whitespace-nowrap rounded-full bg-[color:var(--paper-dark)] px-[8px] py-[3px] text-[1.05rem] font-bold tracking-[.3px] text-[color:var(--ink)]">
                {{ b.frequency }}
              </span>
            </td>
            <td class="text-[color:var(--ink)]">{{ dueText(b) }}</td>
            <td class="text-right font-['DM_Serif_Display'] text-[1.55rem] text-[color:var(--ink)]">{{ b.amount != null ? '$' + Number(b.amount).toFixed(2) : '—' }}</td>
            <td class="max-w-[220px]">
              <div class="overflow-hidden text-ellipsis whitespace-nowrap text-[color:var(--ink-light)]">{{ b.method || '—' }}</div>
              <span
                class="mt-1 inline-flex whitespace-nowrap rounded-full px-[9px] py-[3px] text-[1.05rem] font-semibold"
                :class="b.autopay === 'Yes' ? 'bg-[color:var(--blue-light)] text-[color:var(--blue)]' : 'bg-[color:var(--paper-dark)] text-[color:var(--ink-light)]'"
              >
                {{ b.autopay === 'Yes' ? 'AUTO-PAY' : 'Manual' }}
              </span>
            </td>
            <td class="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-[color:var(--ink-light)]">
              {{ b.notes || '—' }}
            </td>
            <td>
              <div class="flex justify-end gap-[calc(7px*var(--layout-scale-n)/var(--layout-scale-d))]">
                <button class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="openEdit(b)">Edit</button>
                <button class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="deleteBill(b.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <BillModal :open="modalOpen" :bill="editing" @close="closeModal()" @saved="load({ silent: true, preserveScroll: true })" />
  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="load({ silent: true, preserveScroll: true })" />
</template>

