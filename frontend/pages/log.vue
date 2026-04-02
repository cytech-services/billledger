<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import BillDetailModal from '~/components/BillDetailModal.vue'
import { useConfirm } from '~/composables/useConfirm'

type Bill = { id: number; name: string; amount?: number | null }
type Payment = {
  id: number
  bill_id: number
  bill_name?: string
  paid_date: string
  amount?: number | null
  method?: string | null
  paid_by?: string | null
  confirm_num?: string | null
  notes?: string | null
}

const api = useApi()
const { confirm } = useConfirm()
const bills = ref<Bill[]>([])
const payments = ref<Payment[]>([])
const loading = ref(false)
const err = ref<string | null>(null)
const selectedBillIds = ref<number[]>([])
const billPickerOpen = ref(false)
const billSearch = ref('')
const billPickerEl = ref<HTMLElement | null>(null)
const filterFrom = ref<string>('')
const filterTo = ref<string>('')
const editing = ref<Payment | null>(null)
const editOpen = ref(false)
const saving = ref(false)
const detailOpen = ref(false)
const detailBillId = ref<number | null>(null)

const editPaidDate = ref('')
const editAmount = ref('')
const editMethod = ref('')
const editPaidBy = ref('')
const editConfirmNum = ref('')
const editNotes = ref('')

const billAmountById = computed(() => new Map(bills.value.map((b) => [b.id, b.amount ?? null])))
const selectedBillIdsSet = computed(() => new Set(selectedBillIds.value))
const filteredBills = computed(() => {
  const q = billSearch.value.trim().toLowerCase()
  if (!q) return bills.value
  return bills.value.filter((b) => String(b.name || '').toLowerCase().includes(q))
})
const selectedBillsLabel = computed(() => {
  if (!selectedBillIds.value.length) return 'All Bills'
  const byId = new Map(bills.value.map((b) => [b.id, b.name]))
  const names = selectedBillIds.value.map((id) => byId.get(id)).filter(Boolean) as string[]
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
})

const totalExpected = computed(() =>
  payments.value.reduce((s, p) => s + (Number(billAmountById.value.get(p.bill_id) ?? 0) || 0), 0)
)
const totalPaid = computed(() => payments.value.reduce((s, p) => s + (Number(p.amount) || 0), 0))
const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function iso(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function load() {
  loading.value = true
  err.value = null
  try {
    bills.value = await api.get<Bill[]>('/api/bills')
    const params: string[] = []
    if (selectedBillIds.value.length) params.push(`bill_id=${encodeURIComponent(selectedBillIds.value.join(','))}`)
    if (filterFrom.value) params.push(`from=${encodeURIComponent(filterFrom.value)}`)
    if (filterTo.value) params.push(`to=${encodeURIComponent(filterTo.value)}`)
    const url = params.length ? `/api/payments?${params.join('&')}` : '/api/payments'
    payments.value = await api.get<Payment[]>(url)
  } catch (e: any) {
    err.value = e?.message || 'Failed to load payments'
  } finally {
    loading.value = false
  }
}

function toggleBill(id: number) {
  const idx = selectedBillIds.value.indexOf(id)
  if (idx >= 0) selectedBillIds.value.splice(idx, 1)
  else selectedBillIds.value.push(id)
  selectedBillIds.value.sort((a, b) => a - b)
  load()
}

function clearBills() {
  selectedBillIds.value = []
  load()
}

function openDetail(billId: number) {
  detailBillId.value = billId
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailBillId.value = null
}

function onDocClick(e: MouseEvent) {
  if (!billPickerOpen.value) return
  const el = billPickerEl.value
  if (!el) return
  const t = e.target as Node | null
  if (t && el.contains(t)) return
  billPickerOpen.value = false
}

function openEdit(p: Payment) {
  editing.value = p
  editPaidDate.value = p.paid_date || ''
  editAmount.value = p.amount == null ? '' : String(p.amount)
  editMethod.value = p.method || ''
  editPaidBy.value = p.paid_by || ''
  editConfirmNum.value = p.confirm_num || ''
  editNotes.value = p.notes || ''
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
  editing.value = null
}

async function saveEdit() {
  if (!editing.value) return
  if (!editPaidDate.value) return
  saving.value = true
  try {
    await api.put(`/api/payments/${editing.value.id}`, {
      paid_date: editPaidDate.value,
      amount: editAmount.value ? Number(editAmount.value) : null,
      method: editMethod.value.trim(),
      paid_by: editPaidBy.value.trim(),
      confirm_num: editConfirmNum.value.trim(),
      notes: editNotes.value.trim(),
    })
    closeEdit()
    await load()
  } catch (e: any) {
    err.value = e?.message || 'Failed to update payment'
  } finally {
    saving.value = false
  }
}

async function removePayment(id: number) {
  const ok = await confirm({
    title: 'Remove payment?',
    message: 'Remove this payment record?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await api.del(`/api/payments/${id}`)
    await load()
  } catch (e: any) {
    err.value = e?.message || 'Failed to remove payment'
  }
}

onMounted(() => {
  const t = new Date(new Date().toDateString())
  const from = new Date(t)
  from.setMonth(from.getMonth() - 6)
  filterFrom.value = iso(from)
  filterTo.value = iso(t)
  document.addEventListener('click', onDocClick, true)
  load()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
})
</script>

<template>
  <div class="page active">
    <div class="mb-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-center justify-between">
      <h2 class="font-['DM_Serif_Display'] text-[2rem]">Payment Log</h2>
    </div>
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="min-w-[220px]">
        <label class="mb-1 ml-1 block text-[1.1rem] font-semibold text-[color:var(--ink-light)]">Bill</label>
        <div ref="billPickerEl" class="relative" @keydown.esc="billPickerOpen=false">
          <button
            type="button"
            class="inline-flex w-full min-w-[240px] items-center justify-between gap-[10px] rounded-[10px] border border-[color:var(--border)] bg-[color:var(--paper)] px-[11px] py-2 text-[1.3rem] text-[color:var(--ink)] transition-colors hover:border-[color:var(--accent)]"
            @click="billPickerOpen = !billPickerOpen"
          >
            {{ selectedBillsLabel }}
          </button>
          <div
            v-if="billPickerOpen"
            class="absolute left-0 top-[calc(100%+6px)] z-50 w-[320px] max-w-[72vw] rounded-xl border border-[color:var(--border)] bg-[color:var(--cream)] p-[10px] shadow-[0_8px_30px_var(--shadow)]"
            @click.stop
          >
            <div class="mb-2 flex items-center gap-2">
              <input
                v-model="billSearch"
                class="flex-1 px-[10px] py-2 text-[1.3rem]"
                placeholder="Search bills…"
              />
              <button type="button" class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="clearBills()">Clear</button>
            </div>
            <div class="max-h-[260px] space-y-1 overflow-auto pr-1">
              <label
                v-for="b in filteredBills"
                :key="b.id"
                class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-[8px] py-[7px] text-[color:var(--ink)] transition-colors"
                :class="selectedBillIdsSet.has(b.id) ? 'border-[color:var(--accent)] bg-[color:var(--accent-light)]' : 'border-transparent hover:border-[color:var(--border)] hover:bg-[color:var(--paper-dark)]'"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 shrink-0 accent-[color:var(--accent)]"
                  :checked="selectedBillIdsSet.has(b.id)"
                  @change="toggleBill(b.id)"
                />
                <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[1.28rem] font-medium">
                  {{ b.name }}
                </span>
                <span v-if="selectedBillIdsSet.has(b.id)" class="shrink-0 text-[1.1rem] font-semibold text-[color:var(--accent-dark)]">Selected</span>
              </label>
              <div v-if="!filteredBills.length" class="mt-2 p-0 text-center text-[1.3rem] italic text-[color:var(--ink-light)]">No matches</div>
            </div>
          </div>
        </div>
      </div>
      <div class="min-w-[180px]">
        <label class="mb-1 ml-1 block text-[1.1rem] font-semibold text-[color:var(--ink-light)]">From</label>
        <input v-model="filterFrom" type="date" @change="load()" />
      </div>
      <div class="min-w-[180px]">
        <label class="mb-1 ml-1 block text-[1.1rem] font-semibold text-[color:var(--ink-light)]">To</label>
        <input v-model="filterTo" type="date" @change="load()" />
      </div>
    </div>

    <div v-if="err" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">{{ err }}</div>
    <div v-else-if="loading" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">Loading…</div>
    <div v-else-if="!payments.length" class="empty block">
      <div class="empty-icon">📝</div>
      <h3>No payments yet</h3>
      <p>Record payments to see them here.</p>
    </div>
    <div v-else class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-[color:var(--border)] bg-[color:var(--paper)] px-4 py-3">
          <div class="text-[1.1rem] font-semibold text-[color:var(--ink-light)]">Total expected</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] text-[color:var(--ink)]">{{ fmtMoney(totalExpected) }}</div>
        </div>
        <div class="rounded-xl border border-[color:var(--border)] bg-[color:var(--paper)] px-4 py-3">
          <div class="text-[1.1rem] font-semibold text-[color:var(--ink-light)]">Total actual paid</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] text-[color:var(--green)]">{{ fmtMoney(totalPaid) }}</div>
        </div>
      </div>

      <div id="log-list" class="space-y-2">
      <div v-for="p in payments" :key="p.id" class="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-4 py-3 transition-shadow hover:shadow-[0_2px_10px_var(--shadow)]">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-[minmax(320px,1fr)_auto] md:items-start">
          <div class="min-w-0">
          <div class="grid grid-cols-1 items-baseline gap-2 md:grid-cols-[minmax(220px,1fr)_max-content] md:gap-3">
            <div
              class="min-w-0 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-[1.5rem] font-[650] text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline"
              @click="openDetail(p.bill_id)"
            >
              {{ p.bill_name || 'Unknown' }}
            </div>
            <div class="justify-self-start text-[1.2rem] whitespace-nowrap text-[color:var(--ink-light)] md:justify-self-end">
              Expected: <span class="font-semibold text-[color:var(--ink)]">{{ fmtMoney(billAmountById.get(p.bill_id) ?? null) }}</span>
            </div>
          </div>

          <div class="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-[1.2rem] leading-6 text-[color:var(--ink-light)]">
            <div class="flex items-baseline gap-1.5">
              <span class="rounded-full border border-[color:var(--border)] bg-[color:var(--paper-dark)] px-[7px] py-[1px] text-[1.15rem] font-bold text-[color:var(--ink)]">Paid on</span>
              <span class="text-[color:var(--ink)]">{{ new Date(p.paid_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
            </div>
            <div v-if="p.method" class="flex items-baseline gap-1.5">
              <span class="rounded-full border border-[color:var(--border)] bg-[color:var(--paper-dark)] px-[7px] py-[1px] text-[1.15rem] font-bold text-[color:var(--ink)]">Method</span>
              <span class="text-[color:var(--ink)]">{{ p.method }}</span>
            </div>
            <div v-if="p.confirm_num" class="flex items-baseline gap-1.5">
              <span class="rounded-full border border-[color:var(--border)] bg-[color:var(--paper-dark)] px-[7px] py-[1px] text-[1.15rem] font-bold text-[color:var(--ink)]">Ref</span>
              <span class="text-[color:var(--ink)]">{{ p.confirm_num }}</span>
            </div>
            <div v-if="p.paid_by" class="flex items-baseline gap-1.5">
              <span class="rounded-full border border-[color:var(--border)] bg-[color:var(--paper-dark)] px-[7px] py-[1px] text-[1.15rem] font-bold text-[color:var(--ink)]">Paid by</span>
              <span class="text-[color:var(--ink)]"><strong>{{ p.paid_by }}</strong></span>
            </div>
            <div v-if="p.notes" class="basis-full">
              <span class="rounded-full border border-[color:var(--border)] bg-[color:var(--paper-dark)] px-[7px] py-[1px] text-[1.15rem] font-bold text-[color:var(--ink)]">Notes</span>
              <span class="ml-2 text-[color:var(--ink)]">{{ p.notes }}</span>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 md:items-end">
          <div class="text-right font-['DM_Serif_Display'] text-[1.8rem] whitespace-nowrap text-[color:var(--green)]">
            {{ fmtMoney(p.amount) }}
          </div>
          <div class="flex gap-2 md:justify-end">
            <button class="rounded-lg border border-[color:var(--border)] px-3 py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="openEdit(p)">Edit</button>
            <button class="rounded-lg bg-[color:var(--red-light)] px-3 py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="removePayment(p.id)">Remove</button>
          </div>
        </div>
      </div>
      </div>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-[color:var(--border)] bg-[color:var(--paper)] px-4 py-3">
          <div class="text-[1.1rem] font-semibold text-[color:var(--ink-light)]">Total expected</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] text-[color:var(--ink)]">{{ fmtMoney(totalExpected) }}</div>
        </div>
        <div class="rounded-xl border border-[color:var(--border)] bg-[color:var(--paper)] px-4 py-3">
          <div class="text-[1.1rem] font-semibold text-[color:var(--ink-light)]">Total actual paid</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] text-[color:var(--green)]">{{ fmtMoney(totalPaid) }}</div>
        </div>
      </div>
    </div>
  </div>

  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="load()" />

  <div class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]" :class="{ '!flex': editOpen }" @click.self="closeEdit()">
    <div class="max-h-[92vh] w-[calc(540px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div class="mb-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] font-['DM_Serif_Display'] text-[2.1rem]">Edit Payment</div>
      <div class="mb-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] rounded-lg bg-[color:var(--paper-dark)] px-[calc(15px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(11px*var(--layout-scale-n)/var(--layout-scale-d))] text-[1.3rem] leading-[1.6]">
        <strong>{{ editing?.bill_name || 'Payment' }}</strong><br />
        <span class="text-[1.2rem] text-[color:var(--ink-light)]">Payment ID: {{ editing?.id }}</span>
      </div>

      <div class="grid grid-cols-2 gap-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div class="flex flex-col gap-[5px]">
          <label>Payment Date *</label>
          <input v-model="editPaidDate" type="date" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Amount ($)</label>
          <input v-model="editAmount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid With (method / card)</label>
          <input v-model="editMethod" placeholder="e.g. Mastercard" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid By (person)</label>
          <input v-model="editPaidBy" placeholder="e.g. Tom, Sarah, Joint…" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Confirmation #</label>
          <input v-model="editConfirmNum" placeholder="Optional" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Notes</label>
          <textarea v-model="editNotes" placeholder="Optional" />
        </div>
      </div>

      <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex justify-end gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" :disabled="saving" @click="closeEdit()">Cancel</button>
        <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)] disabled:opacity-60" :disabled="saving || !editPaidDate" @click="saveEdit()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Save Changes</span>
        </button>
      </div>
    </div>
  </div>
</template>

