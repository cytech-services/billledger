<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'

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
  const ok = confirm('Remove this payment record?')
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
    <div class="sec-hdr"><h2>Payment Log</h2></div>
    <div class="log-filters">
      <div>
        <label style="display:block;font-size:1.1rem;color:var(--ink-light);margin:0 0 4px 2px">Bill</label>
        <div ref="billPickerEl" class="msel" @keydown.esc="billPickerOpen=false">
          <button type="button" class="msel-btn" @click="billPickerOpen = !billPickerOpen">
            {{ selectedBillsLabel }}
          </button>
          <div v-if="billPickerOpen" class="msel-pop" @click.stop>
            <div class="msel-top">
              <input v-model="billSearch" class="msel-search" placeholder="Search bills…" />
              <button type="button" class="btn btn-ghost btn-sm" @click="clearBills()">Clear</button>
            </div>
            <div class="msel-list">
              <label v-for="b in filteredBills" :key="b.id" class="msel-item">
                <input type="checkbox" :checked="selectedBillIdsSet.has(b.id)" @change="toggleBill(b.id)" />
                <span>{{ b.name }}</span>
              </label>
              <div v-if="!filteredBills.length" class="none-msg" style="margin:8px 0 0">No matches</div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <label style="display:block;font-size:1.1rem;color:var(--ink-light);margin:0 0 4px 2px">From</label>
        <input v-model="filterFrom" type="date" @change="load()" />
      </div>
      <div>
        <label style="display:block;font-size:1.1rem;color:var(--ink-light);margin:0 0 4px 2px">To</label>
        <input v-model="filterTo" type="date" @change="load()" />
      </div>
    </div>

    <div v-if="err" class="none-msg">{{ err }}</div>
    <div v-else-if="loading" class="none-msg">Loading…</div>
    <div v-else-if="!payments.length" class="empty" style="display: block">
      <div class="empty-icon">📝</div>
      <h3>No payments yet</h3>
      <p>Record payments to see them here.</p>
    </div>
    <div v-else>
      <div class="log-totals">
        <div class="log-total">
          <div class="log-total-label">Total expected</div>
          <div class="log-total-value">{{ fmtMoney(totalExpected) }}</div>
        </div>
        <div class="log-total">
          <div class="log-total-label">Total actual paid</div>
          <div class="log-total-value" style="color: var(--green)">{{ fmtMoney(totalPaid) }}</div>
        </div>
      </div>

      <div id="log-list">
      <div v-for="p in payments" :key="p.id" class="lrow">
        <div class="l-main">
          <div class="l-top">
            <div class="l-name">{{ p.bill_name || 'Unknown' }}</div>
            <div class="l-amt">
              {{ fmtMoney(p.amount) }}<span class="l-due-amt"> ({{ fmtMoney(billAmountById.get(p.bill_id) ?? null) }})</span>
            </div>
          </div>

          <div class="l-details">
            <div class="l-kv">
              <span class="l-k">Paid on</span>
              <span class="l-v">{{ new Date(p.paid_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</span>
            </div>
            <div v-if="p.method" class="l-kv">
              <span class="l-k">Method</span>
              <span class="l-v">{{ p.method }}</span>
            </div>
            <div v-if="p.confirm_num" class="l-kv">
              <span class="l-k">Ref</span>
              <span class="l-v">{{ p.confirm_num }}</span>
            </div>
            <div v-if="p.paid_by" class="l-kv">
              <span class="l-k">Paid by</span>
              <span class="l-v"><strong>{{ p.paid_by }}</strong></span>
            </div>
            <div v-if="p.notes" class="l-kv l-notes">
              <span class="l-k">Notes</span>
              <span class="l-v">{{ p.notes }}</span>
            </div>
          </div>
        </div>

        <div class="log-actions">
          <button class="btn btn-ghost btn-sm" @click="openEdit(p)">Edit</button>
          <button class="btn btn-danger btn-sm" @click="removePayment(p.id)">Remove</button>
        </div>
      </div>
      </div>

      <div class="log-totals log-totals-bottom">
        <div class="log-total">
          <div class="log-total-label">Total expected</div>
          <div class="log-total-value">{{ fmtMoney(totalExpected) }}</div>
        </div>
        <div class="log-total">
          <div class="log-total-label">Total actual paid</div>
          <div class="log-total-value" style="color: var(--green)">{{ fmtMoney(totalPaid) }}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="overlay" :class="{ open: editOpen }" @click.self="closeEdit()">
    <div class="modal">
      <div class="modal-title">Edit Payment</div>
      <div class="pay-info">
        <strong>{{ editing?.bill_name || 'Payment' }}</strong><br />
        <span style="color: var(--ink-light); font-size: 1.2rem">Payment ID: {{ editing?.id }}</span>
      </div>

      <div class="fgrid">
        <div class="fg">
          <label>Payment Date *</label>
          <input v-model="editPaidDate" type="date" />
        </div>
        <div class="fg">
          <label>Amount ($)</label>
          <input v-model="editAmount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="fg full">
          <label>Paid With (method / card)</label>
          <input v-model="editMethod" placeholder="e.g. Mastercard" />
        </div>
        <div class="fg full">
          <label>Paid By (person)</label>
          <input v-model="editPaidBy" placeholder="e.g. Tom, Sarah, Joint…" />
        </div>
        <div class="fg">
          <label>Confirmation #</label>
          <input v-model="editConfirmNum" placeholder="Optional" />
        </div>
        <div class="fg full">
          <label>Notes</label>
          <textarea v-model="editNotes" placeholder="Optional" />
        </div>
      </div>

      <div class="mfooter">
        <button class="btn btn-ghost" :disabled="saving" @click="closeEdit()">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || !editPaidDate" @click="saveEdit()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Save Changes</span>
        </button>
      </div>
    </div>
  </div>
</template>

