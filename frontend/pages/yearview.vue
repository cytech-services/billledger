<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import PaymentModal from '~/components/PaymentModal.vue'
import BillDetailModal from '~/components/BillDetailModal.vue'

type YearOccurrence = {
  bill_id: number
  bill_name: string
  company: string
  amount: number | null
  due_date: string
  frequency: string
  autopay: 'Yes' | 'No'
  status: 'overdue' | 'due-soon' | 'upcoming' | 'paid'
  paid_date: string | null
  paid_by: string | null
  paid_amount: number | null
}

type YearMonth = {
  month: string
  occurrences: YearOccurrence[]
  total: number
  total_unpaid: number
}

type YearView = {
  year: number
  year_total: number
  year_unpaid: number
  year_paid_total: number
  count: number
  months: YearMonth[]
}

const api = useApi()
const currentYear = ref(new Date().getFullYear())
const data = ref<YearView | null>(null)
const loading = ref(false)
const err = ref<string | null>(null)
const payOpen = ref(false)
const payingBill = ref<any | null>(null)
const detailOpen = ref(false)
const detailBillId = ref<number | null>(null)
const upcomingOnly = ref(false)

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const overdueOccurrences = computed(() => (data.value?.months || []).flatMap((m) => m.occurrences).filter((o) => o.status === 'overdue'))
const overdueCount = computed(() => overdueOccurrences.value.length)
const overdueAmount = computed(() => overdueOccurrences.value.reduce((s, o) => s + (Number(o.amount) || 0), 0))

function monthName(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

async function load() {
  loading.value = true
  err.value = null
  try {
    data.value = await api.get<YearView>(`/api/year-view?year=${currentYear.value}`)
  } catch (e: any) {
    err.value = e?.message || 'Failed to load year view'
  } finally {
    loading.value = false
  }
}

async function openPay(billId: number) {
  try {
    payingBill.value = await api.get<any>(`/api/bills/${billId}`)
    payOpen.value = true
  } catch (e: any) {
    err.value = e?.message || 'Unable to load bill'
  }
}

function closePay() {
  payOpen.value = false
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

function changeYear(dir: number) {
  currentYear.value += dir
  load()
}

function occPasses(o: YearOccurrence) {
  if (!upcomingOnly.value) return true
  return o.status === 'upcoming' || o.status === 'overdue'
}

onMounted(load)
</script>

<template>
  <div class="page active">
    <div class="year-nav">
      <button class="year-nav-btn" @click="changeYear(-1)">←</button>
      <div class="year-display">{{ currentYear }}</div>
      <button class="year-nav-btn" @click="changeYear(1)">→</button>
      <span style="color: var(--ink-light); font-size: 1.3rem; margin-left: 8px">All scheduled payments for the year</span>
    </div>

    <div v-if="err" class="none-msg">{{ err }}</div>
    <div v-else-if="loading || !data" class="none-msg" style="padding: calc(40px * var(--layout-scale-n) / var(--layout-scale-d))">
      Loading…
    </div>
    <div v-else>
      <div class="year-cards" id="year-summary">
        <div v-if="overdueCount > 0" class="year-cards-top">
          <div class="card red"><div class="card-label">Overdue</div><div class="card-value">{{ overdueCount }}</div></div>
          <div class="card red">
            <div class="card-label">Amount Overdue</div>
            <div class="card-value" style="font-size: 2rem">{{ fmtMoney(overdueAmount) }}</div>
          </div>
        </div>
        <div class="year-cards-main">
          <div class="card blue"><div class="card-label">Total Bills</div><div class="card-value">{{ data.count }}</div></div>
          <div class="card purple">
            <div class="card-label">Total Scheduled</div>
            <div class="card-value" style="font-size: 2rem">{{ fmtMoney(data.year_total) }}</div>
          </div>
          <div class="card amber">
            <div class="card-label">Unpaid / Upcoming</div>
            <div class="card-value" style="font-size: 2rem">{{ fmtMoney(data.year_unpaid) }}</div>
          </div>
          <div class="card green">
            <div class="card-label">Already Paid</div>
            <div class="card-value" style="font-size: 2rem">{{ fmtMoney(data.year_paid_total) }}</div>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin:0 0 calc(14px * var(--layout-scale-n) / var(--layout-scale-d))">
        <button class="btn btn-ghost btn-sm" @click="upcomingOnly = !upcomingOnly">
          {{ upcomingOnly ? 'Showing: Unpaid only' : 'Showing: All' }}
        </button>
        <span style="color: var(--ink-light); font-size: 1.2rem">Toggle to hide paid items.</span>
      </div>

      <div id="year-content">
        <div v-if="!data.months.length" class="none-msg" style="padding: calc(40px * var(--layout-scale-n) / var(--layout-scale-d))">
          No bills scheduled for this year.
        </div>
        <div v-else>
          <div v-for="m in data.months" :key="m.month" class="month-section">
            <div class="month-header">
              <div class="month-name">{{ monthName(m.month) }}</div>
              <div class="month-total">
                {{ m.occurrences.filter(occPasses).length }} bill{{ m.occurrences.filter(occPasses).length === 1 ? '' : 's' }} · unpaid:
                <strong>{{ fmtMoney(m.total_unpaid) }}</strong>
              </div>
            </div>

            <div v-for="o in m.occurrences.filter(occPasses)" :key="`${o.bill_id}:${o.due_date}`" class="yrow" :class="o.status">
              <div class="y-date">{{ new Date(o.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</div>
              <div>
                <div class="y-name" @click="openDetail(o.bill_id)">{{ o.bill_name }}</div>
                <div class="y-co">{{ o.company }}{{ o.autopay === 'Yes' ? ' · AUTO-PAY' : '' }}</div>
                <span v-if="o.status === 'paid' && o.paid_date" style="font-size: 1.1rem; color: var(--green)">
                  Paid {{ new Date(o.paid_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                </span>
              </div>
              <div class="y-amt-wrap">
                <div class="y-amt">{{ fmtMoney(o.amount) }}</div>
                <div v-if="o.status === 'paid' && o.paid_amount != null" class="y-paid-amt">{{ fmtMoney(o.paid_amount) }}</div>
              </div>
              <div><span class="y-freq">{{ o.frequency }}</span></div>
              <div><span class="badge" :class="o.status">{{ o.status }}</span></div>
              <div>
                <button
                  v-if="o.status === 'overdue' || o.status === 'upcoming'"
                  class="btn btn-pay btn-sm"
                  @click="openPay(o.bill_id)"
                >
                  Mark Paid
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <PaymentModal :open="payOpen" :bill="payingBill" @close="closePay()" @saved="load()" />
  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="load()" />
</template>

