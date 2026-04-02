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
const loading = ref(true)
const err = ref<string | null>(null)
const customNextDueByBillId = ref<Record<number, string | null>>({})

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

function calcNextDue(b: Bill): Date | null {
  const t = today()
  if (b.frequency === 'Monthly') {
    const day = Number(b.due_day)
    if (!day) return null
    let d = new Date(t.getFullYear(), t.getMonth(), day)
    if (d <= t) d = new Date(t.getFullYear(), t.getMonth() + 1, day)
    return d
  }
  if (b.frequency === 'Custom') {
    const next = customNextDueByBillId.value[b.id]
    return next ? new Date(next + 'T00:00:00') : null
  }
  if (b.frequency === 'Estimated Tax (US/NY)') {
    const y = t.getFullYear()
    const cand = [new Date(y, 0, 15), new Date(y, 3, 15), new Date(y, 5, 15), new Date(y, 8, 15), new Date(y + 1, 0, 15)]
    return cand.find((d) => d >= t) || null
  }
  if (b.next_date) return new Date(b.next_date + 'T00:00:00')
  return null
}

function daysUntil(d: Date | null) {
  if (!d) return null
  return Math.round((d.getTime() - today().getTime()) / 86400000)
}

const lastPayByBillId = computed(() => {
  const map = new Map<number, Payment>()
  for (const p of payments.value) {
    const cur = map.get(p.bill_id)
    if (!cur || p.paid_date > cur.paid_date) map.set(p.bill_id, p)
  }
  return map
})

type Status = 'overdue' | 'due-soon' | 'upcoming' | 'paid'

function getCycleStart(b: Bill, nd: Date) {
  const d = new Date(nd)
  if (b.frequency === 'Estimated Tax (US/NY)') {
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    if (month === 1) return new Date(year - 1, 8, 15)
    if (month === 4) return new Date(year, 0, 15)
    if (month === 6) return new Date(year, 3, 15)
    if (month === 9) return new Date(year, 5, 15)
  }
  const m: Record<string, number> = { Monthly: 1, 'Bi-Monthly': 2, Quarterly: 3, 'Semi-Annual': 6, Annual: 12 }
  if (m[b.frequency]) {
    d.setMonth(d.getMonth() - m[b.frequency])
    return d
  }
  if (b.frequency === 'Weekly') {
    d.setDate(d.getDate() - 7)
    return d
  }
  if (b.frequency === 'Bi-Weekly') {
    d.setDate(d.getDate() - 14)
    return d
  }
  return d
}

function getStatus(b: Bill): Status {
  const nd = calcNextDue(b)
  const days = daysUntil(nd)
  const lastPay = lastPayByBillId.value.get(b.id)
  if (lastPay && nd) {
    const payDt = new Date(lastPay.paid_date + 'T00:00:00')
    if (b.frequency === 'Custom') {
      // For custom schedules, treat as paid when the latest payment maps to the next due date
      // in the same calendar month (e.g., pay on 2026-04-02 for due 2026-04-30).
      if (payDt.getFullYear() === nd.getFullYear() && payDt.getMonth() === nd.getMonth()) return 'paid'
    }
    const cycleStart = getCycleStart(b, nd)
    if (payDt >= cycleStart) return 'paid'
  }
  if (days == null) return 'upcoming'
  if (days < 0) return 'overdue'
  if (days <= 15) return 'due-soon'
  return 'upcoming'
}

function isDueInCurrentMonth(b: Bill) {
  const t = today()
  const nd = calcNextDue(b)
  return !!nd && nd.getFullYear() === t.getFullYear() && nd.getMonth() === t.getMonth()
}

const monthBills = computed(() => bills.value.filter(isDueInCurrentMonth))

const overdueBills = computed(() => {
  const t = today()
  const min = new Date(t)
  min.setDate(min.getDate() - 30)
  return bills.value.filter((b) => {
    const nd = calcNextDue(b)
    if (!nd) return false
    if (nd < min) return false
    if (nd >= t) return false
    return getStatus(b) === 'overdue'
  })
})
const soonBills = computed(() => monthBills.value.filter((b) => getStatus(b) === 'due-soon'))
const upcomingBills = computed(() =>
  monthBills.value
    .filter((b) => getStatus(b) === 'upcoming')
    .sort((a, b) => {
      const ad = calcNextDue(a)?.getTime() ?? Number.POSITIVE_INFINITY
      const bd = calcNextDue(b)?.getTime() ?? Number.POSITIVE_INFINITY
      return ad - bd
    })
)
const paidBills = computed(() => monthBills.value.filter((b) => getStatus(b) === 'paid'))
const dueThisMonthBills = computed(() => {
  return bills.value.filter((b) => {
    if (getStatus(b) === 'paid') return false
    return isDueInCurrentMonth(b)
  })
})

const monthKey = computed(() => {
  const t = today()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
})
const paidThisMonthPayments = computed(() => {
  const inMonth = payments.value.filter((p) => String(p.paid_date || '').startsWith(monthKey.value))
  const monthBillIds = new Set(monthBills.value.map((b) => b.id))
  return inMonth.filter((p) => monthBillIds.has(p.bill_id))
})

const amtOverdue = computed(() => overdueBills.value.reduce((s, b) => s + (Number(b.amount) || 0), 0))
const amtSoon = computed(() => soonBills.value.reduce((s, b) => s + (Number(b.amount) || 0), 0))
const amtDueThisMonth = computed(() => dueThisMonthBills.value.reduce((s, b) => s + (Number(b.amount) || 0), 0))
const amtPaidThisMonth = computed(() => paidThisMonthPayments.value.reduce((s, p) => s + (Number(p.amount) || 0), 0))

async function loadDashboard() {
  loading.value = true
  err.value = null
  try {
    const cutoff = today()
    cutoff.setMonth(cutoff.getMonth() - 6)
    const from = fmtIsoDate(cutoff)
    const to = fmtIsoDate(today())
    const [b, p] = await Promise.all([api.get<Bill[]>('/api/bills'), api.get<Payment[]>(`/api/payments?from=${from}&to=${to}`)])
    bills.value = b
    payments.value = p

    // Custom bills need their next due date from details endpoint.
    const customBills = b.filter((x) => x.frequency === 'Custom')
    const pairs = await Promise.all(
      customBills.map(async (cb) => {
        try {
          const details = await api.get<{ upcoming: string[] }>(`/api/bills/${cb.id}/details`)
          return [cb.id, details.upcoming?.[0] || null] as const
        } catch {
          return [cb.id, null] as const
        }
      })
    )
    const map: Record<number, string | null> = {}
    for (const [id, next] of pairs) map[id] = next
    customNextDueByBillId.value = map
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

async function undoLatestPayment(billId: number) {
  const ok = await confirm({
    title: 'Remove payment?',
    message: 'Remove the most recent payment for this bill?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  const pays = await api.get<Payment[]>(`/api/payments?bill_id=${billId}`)
  if (!pays.length) return
  await api.del(`/api/payments/${pays[0].id}`)
  await loadDashboard()
}

function paidAmountForBill(billId: number) {
  const p = lastPayByBillId.value.get(billId)
  return p?.amount ?? null
}

function daysLabelForBill(b: Bill, status: Status) {
  const nd = calcNextDue(b)
  const days = daysUntil(nd)
  if (status === 'overdue' && days != null) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (status === 'due-soon' && days != null) return days === 0 ? 'Due today!' : `In ${days} day${days === 1 ? '' : 's'}`
  if (status === 'upcoming' && days != null) return `In ${days} days`
  if (status === 'paid') {
    const p = lastPayByBillId.value.get(b.id)
    if (p?.paid_date) return `Paid ${fmtDate(p.paid_date)}`
  }
  return ''
}

onMounted(loadDashboard)
</script>

<template>
  <div class="page active">
    <div v-if="err" class="none-msg">{{ err }}</div>
    <div v-else>
      <div class="cards">
        <div class="card red"><div class="card-label">Overdue</div><div class="card-value">{{ overdueBills.length }}</div></div>
        <div class="card amber"><div class="card-label">Due Within 15 Days</div><div class="card-value">{{ soonBills.length }}</div></div>
        <div class="card purple"><div class="card-label">Due This Month</div><div class="card-value">{{ dueThisMonthBills.length }}</div></div>
        <div class="card green"><div class="card-label">Paid This Month</div><div class="card-value">{{ paidThisMonthPayments.length }}</div></div>

        <div class="card red"><div class="card-label">Amount Overdue</div><div class="card-value" style="font-size:2rem">{{ fmtMoney(amtOverdue) }}</div></div>
        <div class="card amber"><div class="card-label">Amount Due Within 15 Days</div><div class="card-value" style="font-size:2rem">{{ fmtMoney(amtSoon) }}</div></div>
        <div class="card purple"><div class="card-label">Amount Due This Month</div><div class="card-value" style="font-size:2rem">{{ fmtMoney(amtDueThisMonth) }}</div></div>
        <div class="card green"><div class="card-label">Amount Paid This Month</div><div class="card-value" style="font-size:2rem">{{ fmtMoney(amtPaidThisMonth) }}</div></div>
      </div>

      <div v-if="loading" class="none-msg">Loading…</div>
      <div v-else>
        <div class="sec">
          <div class="sec-title">⚠ Overdue</div>
          <div class="bill-list">
            <div v-if="!overdueBills.length" class="none-msg">No overdue bills 🎉</div>
            <div v-for="b in overdueBills" :key="b.id" class="brow overdue">
              <div>
                <div class="b-name" @click="openDetail(b.id)">{{ b.name }}</div>
                <div class="b-co">{{ b.company || '' }}</div>
                <span class="b-freq">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="autopay-tag">AUTO-PAY</span>
              </div>
              <div>
                <div class="b-due">{{ calcNextDue(b) ? fmtDate(calcNextDue(b)!) : '—' }}</div>
                <div class="b-days">{{ daysLabelForBill(b, 'overdue') }}</div>
              </div>
              <div class="b-amt-wrap">
                <div class="b-amt">{{ b.amount != null ? fmtMoney(b.amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="badge overdue">⚠ Overdue</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.id)">Mark Paid</button>
            </div>
          </div>
        </div>

        <div class="sec">
          <div class="sec-title">⏰ Due Within 15 Days</div>
          <div class="bill-list">
            <div v-if="!soonBills.length" class="none-msg">Nothing due in the next 15 days</div>
            <div v-for="b in soonBills" :key="b.id" class="brow due-soon">
              <div>
                <div class="b-name" @click="openDetail(b.id)">{{ b.name }}</div>
                <div class="b-co">{{ b.company || '' }}</div>
                <span class="b-freq">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="autopay-tag">AUTO-PAY</span>
              </div>
              <div>
                <div class="b-due">{{ calcNextDue(b) ? fmtDate(calcNextDue(b)!) : '—' }}</div>
                <div class="b-days">{{ daysLabelForBill(b, 'due-soon') }}</div>
              </div>
              <div class="b-amt-wrap">
                <div class="b-amt">{{ b.amount != null ? fmtMoney(b.amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="badge due-soon">⏰ Due Soon</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.id)">Mark Paid</button>
            </div>
          </div>
        </div>

        <div class="sec">
          <div class="sec-title">📅 Upcoming</div>
          <div class="bill-list">
            <div v-if="!upcomingBills.length" class="none-msg">No upcoming bills</div>
            <div v-for="b in upcomingBills" :key="b.id" class="brow upcoming">
              <div>
                <div class="b-name" @click="openDetail(b.id)">{{ b.name }}</div>
                <div class="b-co">{{ b.company || '' }}</div>
                <span class="b-freq">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="autopay-tag">AUTO-PAY</span>
              </div>
              <div>
                <div class="b-due">{{ calcNextDue(b) ? fmtDate(calcNextDue(b)!) : '—' }}</div>
                <div class="b-days">{{ daysLabelForBill(b, 'upcoming') }}</div>
              </div>
              <div class="b-amt-wrap">
                <div class="b-amt">{{ b.amount != null ? fmtMoney(b.amount) : '—' }}</div>
              </div>
              <div></div>
              <div><span class="badge upcoming">📅 Upcoming</span></div>
              <button class="btn btn-pay btn-sm" @click="openPay(b.id)">Mark Paid</button>
            </div>
          </div>
        </div>

        <div class="sec">
          <div class="sec-title">✅ Paid This Month</div>
          <div class="bill-list">
            <div v-if="!paidBills.length" class="none-msg">No payments recorded this month</div>
            <div v-for="b in paidBills" :key="b.id" class="brow paid">
              <div>
                <div class="b-name" @click="openDetail(b.id)">{{ b.name }}</div>
                <div class="b-co">{{ b.company || '' }}</div>
                <span class="b-freq">{{ b.frequency }}</span><span v-if="b.autopay === 'Yes'" class="autopay-tag">AUTO-PAY</span>
              </div>
              <div>
                <div class="b-due">{{ calcNextDue(b) ? fmtDate(calcNextDue(b)!) : '—' }}</div>
                <div class="b-days">{{ daysLabelForBill(b, 'paid') }}</div>
              </div>
              <div class="b-amt-wrap">
                <div class="b-amt">{{ b.amount != null ? fmtMoney(b.amount) : '—' }}</div>
                <div v-if="paidAmountForBill(b.id) != null" class="b-paid-amt">{{ fmtMoney(paidAmountForBill(b.id) as any) }}</div>
              </div>
              <div></div>
              <div><span class="badge paid">✅ Paid</span></div>
              <button class="btn btn-undo btn-sm" @click="undoLatestPayment(b.id)">Undo</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <PaymentModal :open="payModalOpen" :bill="payingBill" @close="closePay()" @saved="loadDashboard()" />
  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="loadDashboard()" />
</template>

