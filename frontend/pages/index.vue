<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import PaymentModal from '~/components/PaymentModal.vue'
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
}

type Payment = {
  id: number
  bill_id: number
  occurrence_id?: number | null
  occurrence_due_date?: string | null
  bill_name?: string
  paid_date: string
  amount?: number | null
  method?: string | null
  paid_by?: string | null
  confirm_num?: string | null
  notes?: string | null
}

type DashboardOccurrence = {
  occurrence_id: number
  bill_id: number
  due_date: string
  expected_amount?: number | null
  bill_name: string
  company?: string | null
  frequency: string
  autopay?: 'Yes' | 'No'
  payment_id?: number | null
  paid_date?: string | null
  paid_amount?: number | null
}

type DashboardResponse = {
  today: string
  month_start: string
  month_end: string
  overdue_window_start: string
  occurrences: DashboardOccurrence[]
}

const api = useApi()
const { confirm } = useConfirm()
const bills = ref<Bill[]>([])
const payments = ref<Payment[]>([])
const occurrences = ref<DashboardOccurrence[]>([])
const loading = ref(true)
const err = ref<string | null>(null)

const payModalOpen = ref(false)
const payingBill = ref<Bill | null>(null)
const detailOpen = ref(false)
const detailBillId = ref<number | null>(null)

const today = () => new Date(new Date().toDateString())
const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(String(d).includes('T') ? String(d) : String(d) + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtIsoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysUntil(d: Date | null) {
  if (!d) return null
  return Math.round((d.getTime() - today().getTime()) / 86400000)
}

type Status = 'overdue' | 'due-soon' | 'upcoming' | 'paid'
function statusForOccurrence(o: DashboardOccurrence): Status {
  if (o.paid_date) return 'paid'
  const d = new Date(o.due_date + 'T00:00:00')
  const diff = daysUntil(d)
  if (diff == null) return 'upcoming'
  if (diff < 0) return 'overdue'
  if (diff <= 15) return 'due-soon'
  return 'upcoming'
}

const monthKey = computed(() => {
  const t = today()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
})
const monthOccurrences = computed(() => occurrences.value.filter((o) => String(o.due_date || '').startsWith(monthKey.value)))
const billById = computed(() => {
  const map = new Map<number, Bill>()
  for (const b of bills.value) map.set(b.id, b)
  return map
})
const overdueBills = computed(() => {
  const t = today()
  const min = new Date(t)
  min.setDate(min.getDate() - 30)
  return occurrences.value.filter((o) => {
    if (o.paid_date) return false
    const d = new Date(o.due_date + 'T00:00:00')
    return d >= min && d < t
  })
})
const soonBills = computed(() => monthOccurrences.value.filter((o) => statusForOccurrence(o) === 'due-soon'))
const upcomingBills = computed(() =>
  monthOccurrences.value
    .filter((o) => statusForOccurrence(o) === 'upcoming')
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
)
const paidBills = computed(() =>
  paidThisMonthPayments.value
    .map((p) => {
      const bill = billById.value.get(p.bill_id)
      return {
        occurrence_id: p.occurrence_id ?? -p.id,
        bill_id: p.bill_id,
        due_date: p.occurrence_due_date || p.paid_date,
        expected_amount: bill?.amount ?? null,
        bill_name: p.bill_name || bill?.name || 'Unknown',
        company: bill?.company || '',
        frequency: bill?.frequency || 'Unknown',
        autopay: (bill?.autopay as 'Yes' | 'No') || 'No',
        payment_id: p.id,
        paid_date: p.paid_date,
        paid_amount: p.amount ?? null
      } as DashboardOccurrence
    })
    .sort((a, b) => String(b.paid_date || '').localeCompare(String(a.paid_date || '')))
)
const dueThisMonthBills = computed(() => monthOccurrences.value.filter((o) => statusForOccurrence(o) !== 'paid'))

const paidThisMonthPayments = computed(() => {
  return payments.value.filter((p) => String(p.paid_date || '').startsWith(monthKey.value))
})

const amtOverdue = computed(() => overdueBills.value.reduce((s, b) => s + (Number(b.expected_amount) || 0), 0))
const amtSoon = computed(() => soonBills.value.reduce((s, b) => s + (Number(b.expected_amount) || 0), 0))
const amtDueThisMonth = computed(() => dueThisMonthBills.value.reduce((s, b) => s + (Number(b.expected_amount) || 0), 0))
const amtPaidThisMonth = computed(() => paidThisMonthPayments.value.reduce((s, p) => s + (Number(p.amount) || 0), 0))

async function loadDashboard() {
  loading.value = true
  err.value = null
  try {
    const cutoff = today()
    cutoff.setMonth(cutoff.getMonth() - 6)
    const from = fmtIsoDate(cutoff)
    const to = fmtIsoDate(today())
    const [b, p, d] = await Promise.all([
      api.get<Bill[]>('/api/bills'),
      api.get<Payment[]>(`/api/payments?from=${from}&to=${to}`),
      api.get<DashboardResponse>('/api/dashboard-occurrences')
    ])
    bills.value = b
    payments.value = p
    occurrences.value = d.occurrences || []
  } catch (e: any) {
    err.value = e?.message || 'Failed to load dashboard'
  } finally {
    loading.value = false
  }
}

function openPay(billId: number) {
  payingBill.value = bills.value.find((x) => x.id === billId) || null
  payModalOpen.value = true
}

function closePay() {
  payModalOpen.value = false
  payingBill.value = null
}

function openDetail(billId: number) {
  detailBillId.value = billId
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailBillId.value = null
}

async function undoLatestPayment(billId: number, paymentId?: number | null) {
  const ok = await confirm({
    title: 'Remove payment?',
    message: 'Remove the most recent payment for this bill?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  if (paymentId) {
    await api.del(`/api/payments/${paymentId}`)
    await loadDashboard()
    return
  }
  const pays = await api.get<Payment[]>(`/api/payments?bill_id=${billId}`)
  if (!pays.length) return
  await api.del(`/api/payments/${pays[0].id}`)
  await loadDashboard()
}

function paidAmountForBill(occ: DashboardOccurrence) {
  return occ.paid_amount ?? null
}

function daysLabelForBill(occ: DashboardOccurrence, status: Status) {
  const nd = new Date(occ.due_date + 'T00:00:00')
  const days = daysUntil(nd)
  if (status === 'overdue' && days != null) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (status === 'due-soon' && days != null) return days === 0 ? 'Due today!' : `In ${days} day${days === 1 ? '' : 's'}`
  if (status === 'upcoming' && days != null) return `In ${days} days`
  if (status === 'paid') {
    if (occ.paid_date) return `Paid ${fmtDate(occ.paid_date)}`
  }
  return ''
}

onMounted(loadDashboard)
</script>

<template>
  <div class="page active">
    <div v-if="err" class="none-msg">{{ err }}</div>
    <div v-else>
      <div class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))] grid grid-cols-1 gap-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] md:grid-cols-2 xl:grid-cols-4">
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--red)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Overdue</div>
          <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--red)]">{{ overdueBills.length }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--amber)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Due Within 15 Days</div>
          <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--amber)]">{{ soonBills.length }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--purple)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Due This Month</div>
          <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--purple)]">{{ dueThisMonthBills.length }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--green)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Paid This Month</div>
          <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--green)]">{{ paidThisMonthPayments.length }}</div>
        </div>

        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--red)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Amount Overdue</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--red)]">{{ fmtMoney(amtOverdue) }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--amber)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Amount Due Within 15 Days</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--amber)]">{{ fmtMoney(amtSoon) }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--purple)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Amount Due This Month</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--purple)]">{{ fmtMoney(amtDueThisMonth) }}</div>
        </div>
        <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--green)]">
          <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Amount Paid This Month</div>
          <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--green)]">{{ fmtMoney(amtPaidThisMonth) }}</div>
        </div>
      </div>

      <div v-if="loading" class="none-msg">Loading…</div>
      <div v-else>
        <section class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">⚠ Overdue</div>
          <div class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div v-if="!overdueBills.length" class="none-msg">No overdue bills 🎉</div>
            <div
              v-for="b in overdueBills"
              :key="b.occurrence_id"
              class="relative grid grid-cols-[minmax(240px,1.8fr)_130px_110px_72px_130px_120px] items-center gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:bg-[color:var(--red)] hover:-translate-y-[1px] hover:shadow-[0_4px_18px_var(--shadow)]"
            >
              <div>
                <div class="cursor-pointer text-[1.4rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline" @click="openDetail(b.bill_id)">{{ b.bill_name }}</div>
                <div class="mt-[1px] text-[1.2rem] text-[color:var(--ink-light)]">{{ b.company || '' }}</div>
                <span class="mt-1 inline-block rounded-[20px] bg-[color:var(--paper-dark)] px-[7px] py-[2px] text-[1rem] font-bold tracking-[.4px] text-[color:var(--ink-light)]">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="ml-1 inline-block rounded-[20px] bg-[color:var(--blue-light)] px-[7px] py-[2px] text-[1rem] font-bold text-[color:var(--blue)]">AUTO-PAY</span>
              </div>
              <div>
                <div class="text-[1.3rem] font-medium">{{ fmtDate(b.due_date) }}</div>
                <div class="mt-[2px] text-[1.1rem] text-[color:var(--ink-light)]">{{ daysLabelForBill(b, 'overdue') }}</div>
              </div>
              <div class="flex flex-col items-end gap-[3px]">
                <div class="text-right font-['DM_Serif_Display'] text-[1.7rem]">{{ b.expected_amount != null ? fmtMoney(b.expected_amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="inline-flex whitespace-nowrap rounded-[20px] bg-[color:var(--red-light)] px-[9px] py-1 text-[1.1rem] font-semibold text-[color:var(--red)]">⚠ Overdue</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.bill_id)">Mark Paid</button>
            </div>
          </div>
        </section>

        <section class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">⏰ Due Within 15 Days</div>
          <div class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div v-if="!soonBills.length" class="none-msg">Nothing due in the next 15 days</div>
            <div
              v-for="b in soonBills"
              :key="b.occurrence_id"
              class="relative grid grid-cols-[minmax(240px,1.8fr)_130px_110px_72px_130px_120px] items-center gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:bg-[color:var(--amber)] hover:-translate-y-[1px] hover:shadow-[0_4px_18px_var(--shadow)]"
            >
              <div>
                <div class="cursor-pointer text-[1.4rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline" @click="openDetail(b.bill_id)">{{ b.bill_name }}</div>
                <div class="mt-[1px] text-[1.2rem] text-[color:var(--ink-light)]">{{ b.company || '' }}</div>
                <span class="mt-1 inline-block rounded-[20px] bg-[color:var(--paper-dark)] px-[7px] py-[2px] text-[1rem] font-bold tracking-[.4px] text-[color:var(--ink-light)]">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="ml-1 inline-block rounded-[20px] bg-[color:var(--blue-light)] px-[7px] py-[2px] text-[1rem] font-bold text-[color:var(--blue)]">AUTO-PAY</span>
              </div>
              <div>
                <div class="text-[1.3rem] font-medium">{{ fmtDate(b.due_date) }}</div>
                <div class="mt-[2px] text-[1.1rem] text-[color:var(--ink-light)]">{{ daysLabelForBill(b, 'due-soon') }}</div>
              </div>
              <div class="flex flex-col items-end gap-[3px]">
                <div class="text-right font-['DM_Serif_Display'] text-[1.7rem]">{{ b.expected_amount != null ? fmtMoney(b.expected_amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="inline-flex whitespace-nowrap rounded-[20px] bg-[color:var(--amber-light)] px-[9px] py-1 text-[1.1rem] font-semibold text-[color:var(--amber)]">⏰ Due Soon</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.bill_id)">Mark Paid</button>
            </div>
          </div>
        </section>

        <section class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">📅 Upcoming</div>
          <div class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div v-if="!upcomingBills.length" class="none-msg">No upcoming bills</div>
            <div
              v-for="b in upcomingBills"
              :key="b.occurrence_id"
              class="relative grid grid-cols-[minmax(240px,1.8fr)_130px_110px_72px_130px_120px] items-center gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:bg-[color:var(--blue)] hover:-translate-y-[1px] hover:shadow-[0_4px_18px_var(--shadow)]"
            >
              <div>
                <div class="cursor-pointer text-[1.4rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline" @click="openDetail(b.bill_id)">{{ b.bill_name }}</div>
                <div class="mt-[1px] text-[1.2rem] text-[color:var(--ink-light)]">{{ b.company || '' }}</div>
                <span class="mt-1 inline-block rounded-[20px] bg-[color:var(--paper-dark)] px-[7px] py-[2px] text-[1rem] font-bold tracking-[.4px] text-[color:var(--ink-light)]">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="ml-1 inline-block rounded-[20px] bg-[color:var(--blue-light)] px-[7px] py-[2px] text-[1rem] font-bold text-[color:var(--blue)]">AUTO-PAY</span>
              </div>
              <div>
                <div class="text-[1.3rem] font-medium">{{ fmtDate(b.due_date) }}</div>
                <div class="mt-[2px] text-[1.1rem] text-[color:var(--ink-light)]">{{ daysLabelForBill(b, 'upcoming') }}</div>
              </div>
              <div class="flex flex-col items-end gap-[3px]">
                <div class="text-right font-['DM_Serif_Display'] text-[1.7rem]">{{ b.expected_amount != null ? fmtMoney(b.expected_amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="inline-flex whitespace-nowrap rounded-[20px] bg-[color:var(--blue-light)] px-[9px] py-1 text-[1.1rem] font-semibold text-[color:var(--blue)]">📅 Upcoming</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.bill_id)">Mark Paid</button>
            </div>
          </div>
        </section>

        <section class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <div class="mb-[10px] flex items-center gap-2 text-[1.1rem] font-bold uppercase tracking-[.9px] text-[color:var(--ink-light)] after:h-px after:flex-1 after:bg-[color:var(--border)]">✅ Paid This Month</div>
          <div class="flex flex-col gap-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div v-if="!paidBills.length" class="none-msg">No payments recorded this month</div>
            <div
              v-for="b in paidBills"
              :key="b.occurrence_id"
              class="relative grid grid-cols-[minmax(240px,1.8fr)_130px_110px_72px_130px_120px] items-center gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))] opacity-[.82] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1 before:bg-[color:var(--green)] hover:-translate-y-[1px] hover:shadow-[0_4px_18px_var(--shadow)]"
            >
              <div>
                <div class="cursor-pointer text-[1.4rem] font-semibold text-[color:var(--ink)] hover:text-[color:var(--accent)] hover:underline" @click="openDetail(b.bill_id)">{{ b.bill_name }}</div>
                <div class="mt-[1px] text-[1.2rem] text-[color:var(--ink-light)]">{{ b.company || '' }}</div>
                <span class="mt-1 inline-block rounded-[20px] bg-[color:var(--paper-dark)] px-[7px] py-[2px] text-[1rem] font-bold tracking-[.4px] text-[color:var(--ink-light)]">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="ml-1 inline-block rounded-[20px] bg-[color:var(--blue-light)] px-[7px] py-[2px] text-[1rem] font-bold text-[color:var(--blue)]">AUTO-PAY</span>
              </div>
              <div>
                <div class="text-[1.3rem] font-medium">{{ fmtDate(b.due_date) }}</div>
                <div class="mt-[2px] text-[1.1rem] text-[color:var(--green-dark)]">{{ daysLabelForBill(b, 'paid') }}</div>
              </div>
              <div class="flex flex-col items-end gap-[3px]">
                <div class="text-right font-['DM_Serif_Display'] text-[1.7rem]">{{ b.expected_amount != null ? fmtMoney(b.expected_amount) : '—' }}</div>
                <div v-if="paidAmountForBill(b) != null" class="text-[1.1rem] leading-none text-[color:var(--green)]">{{ fmtMoney(paidAmountForBill(b) as any) }}</div>
              </div>
              <div></div>
              <div><span class="inline-flex whitespace-nowrap rounded-[20px] bg-[color:var(--green-light)] px-[9px] py-1 text-[1.1rem] font-semibold text-[color:var(--green)]">✅ Paid</span></div>
              <button class="btn btn-undo btn-sm" @click="undoLatestPayment(b.bill_id, b.payment_id)">Undo</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <PaymentModal :open="payModalOpen" :bill="payingBill" @close="closePay()" @saved="loadDashboard()" />
  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="loadDashboard()" />
</template>

