<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useApi } from '~/composables/useApi'
import PaymentModal from '~/components/PaymentModal.vue'
import BillDetailModal from '~/components/BillDetailModal.vue'
import EditPaymentModal from '~/components/EditPaymentModal.vue'

type YearOccurrence = {
  occurrence_id?: number
  payment_id?: number | null
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
const editOpen = ref(false)
const editingPayment = ref<any | null>(null)
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

async function load(options?: { silent?: boolean; preserveScroll?: boolean }) {
  const silent = options?.silent === true
  const preserveScroll = options?.preserveScroll === true
  const scrollY = preserveScroll ? window.scrollY : 0
  if (!silent) loading.value = true
  err.value = null
  try {
    data.value = await api.get<YearView>(`/api/year-view?year=${currentYear.value}`)
  } catch (e: any) {
    err.value = e?.message || 'Failed to load year view'
  } finally {
    if (!silent) loading.value = false
    if (preserveScroll) {
      await nextTick()
      window.scrollTo({ top: scrollY, behavior: 'auto' })
    }
  }
}

async function openPay(billId: number, occurrenceId?: number | null) {
  try {
    const bill = await api.get<any>(`/api/bills/${billId}`)
    payingBill.value = { ...bill, occurrence_id: occurrenceId ?? null }
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

async function openEditPayment(o: YearOccurrence) {
  if (!o.payment_id) return
  try {
    const p = await api.get<any>(`/api/payments/${o.payment_id}`)
    editingPayment.value = p
    editOpen.value = true
  } catch (e: any) {
    err.value = e?.message || 'Unable to load payment'
  }
}

function closeEditPayment() {
  editOpen.value = false
  editingPayment.value = null
}

onMounted(load)
</script>

<template>
  <div class="page active">
    <div class="mb-[calc(24px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-center gap-[calc(16px*var(--layout-scale-n)/var(--layout-scale-d))]">
      <button class="cursor-pointer rounded-lg border border-[color:var(--border)] bg-transparent px-[14px] py-[7px] text-[1.8rem] text-[color:var(--ink-light)] transition-all hover:bg-[color:var(--paper-dark)] hover:text-[color:var(--ink)]" @click="changeYear(-1)">←</button>
      <div class="min-w-[80px] text-center font-['DM_Serif_Display'] text-[2.8rem] text-[color:var(--ink)]">{{ currentYear }}</div>
      <button class="cursor-pointer rounded-lg border border-[color:var(--border)] bg-transparent px-[14px] py-[7px] text-[1.8rem] text-[color:var(--ink-light)] transition-all hover:bg-[color:var(--paper-dark)] hover:text-[color:var(--ink)]" @click="changeYear(1)">→</button>
      <span class="ml-2 text-[1.3rem] text-[color:var(--ink-light)]">All scheduled payments for the year</span>
    </div>

    <div v-if="err" class="none-msg">{{ err }}</div>
    <div v-else-if="loading || !data" class="none-msg" style="padding: calc(40px * var(--layout-scale-n) / var(--layout-scale-d))">
      Loading…
    </div>
    <div v-else>
      <div id="year-summary" class="mb-[calc(28px*var(--layout-scale-n)/var(--layout-scale-d))] flex flex-col gap-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div v-if="overdueCount > 0" class="grid grid-cols-1 gap-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))] md:grid-cols-2">
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--red)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Overdue</div>
            <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--red)]">{{ overdueCount }}</div>
          </div>
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--red)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Amount Overdue</div>
            <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--red)]">{{ fmtMoney(overdueAmount) }}</div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-[calc(12px*var(--layout-scale-n)/var(--layout-scale-d))] md:grid-cols-2 xl:grid-cols-4">
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--blue)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Total Bills</div>
            <div class="font-['DM_Serif_Display'] text-[2.6rem] leading-none text-[color:var(--blue)]">{{ data.count }}</div>
          </div>
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--purple)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Total Scheduled</div>
            <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--purple)]">{{ fmtMoney(data.year_total) }}</div>
          </div>
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--amber)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Unpaid / Upcoming</div>
            <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--amber)]">{{ fmtMoney(data.year_unpaid) }}</div>
          </div>
          <div class="relative overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] before:absolute before:left-0 before:right-0 before:top-0 before:h-[3px] before:bg-[color:var(--green)]">
            <div class="mb-[7px] text-[1.1rem] font-semibold uppercase tracking-[.7px] text-[color:var(--ink-light)]">Already Paid</div>
            <div class="font-['DM_Serif_Display'] text-[2rem] leading-none text-[color:var(--green)]">{{ fmtMoney(data.year_paid_total) }}</div>
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
          <div v-for="m in data.months" :key="m.month" class="mb-[calc(24px*var(--layout-scale-n)/var(--layout-scale-d))]">
            <div class="mb-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-baseline justify-between border-b-2 border-[color:var(--border)] pb-[calc(8px*var(--layout-scale-n)/var(--layout-scale-d))]">
              <div class="font-['DM_Serif_Display'] text-[1.8rem] text-[color:var(--ink)]">{{ monthName(m.month) }}</div>
              <div class="text-[1.3rem] text-[color:var(--ink-light)]">
                {{ m.occurrences.filter(occPasses).length }} bill{{ m.occurrences.filter(occPasses).length === 1 ? '' : 's' }} · unpaid:
                <strong class="font-['DM_Serif_Display'] text-[1.6rem] text-[color:var(--ink)]">{{ fmtMoney(m.total_unpaid) }}</strong>
              </div>
            </div>

            <div
              v-for="o in m.occurrences.filter(occPasses)"
              :key="`${o.bill_id}:${o.due_date}`"
              class="relative mb-[calc(6px*var(--layout-scale-n)/var(--layout-scale-d))] grid grid-cols-[130px_minmax(240px,1.7fr)_110px_92px_130px_120px] items-center gap-[calc(10px*var(--layout-scale-n)/var(--layout-scale-d))] overflow-hidden rounded-[9px] border border-[color:var(--border)] bg-[color:var(--cream)] px-[calc(16px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(11px*var(--layout-scale-n)/var(--layout-scale-d))] hover:shadow-[0_3px_14px_var(--shadow)]"
              :class="{
                'before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[color:var(--red)]': o.status === 'overdue',
                'before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[color:var(--amber)]': o.status === 'due-soon',
                'before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[color:var(--blue)]': o.status === 'upcoming',
                'before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[color:var(--green)] opacity-80': o.status === 'paid',
              }"
            >
              <div class="text-[1.2rem] font-semibold text-[color:var(--ink-light)]">{{ new Date(o.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</div>
              <div>
                <div class="cursor-pointer text-[1.3rem] font-semibold hover:text-[color:var(--accent)] hover:underline" @click="openDetail(o.bill_id)">{{ o.bill_name }}</div>
                <div class="text-[1.1rem] text-[color:var(--ink-light)]">{{ o.company }}{{ o.autopay === 'Yes' ? ' · AUTO-PAY' : '' }}</div>
                <span v-if="o.status === 'paid' && o.paid_date" style="font-size: 1.1rem; color: var(--green)">
                  Paid {{ new Date(o.paid_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}
                </span>
              </div>
              <div class="flex flex-col items-end gap-[3px]">
                <div class="text-right font-['DM_Serif_Display'] text-[1.5rem]">{{ fmtMoney(o.amount) }}</div>
                <div v-if="o.status === 'paid' && o.paid_amount != null" class="text-[1.1rem] leading-none text-[color:var(--green)]">{{ fmtMoney(o.paid_amount) }}</div>
              </div>
              <div><span class="rounded-[20px] bg-[color:var(--paper-dark)] px-[7px] py-[2px] text-[1rem] font-bold text-[color:var(--ink-light)]">{{ o.frequency }}</span></div>
              <div>
                <span
                  class="rounded-[20px] px-[9px] py-1 text-[1.1rem] font-semibold capitalize"
                  :class="{
                    'bg-[color:var(--red-light)] text-[color:var(--red)]': o.status === 'overdue',
                    'bg-[color:var(--amber-light)] text-[color:var(--amber)]': o.status === 'due-soon',
                    'bg-[color:var(--blue-light)] text-[color:var(--blue)]': o.status === 'upcoming',
                    'bg-[color:var(--green-light)] text-[color:var(--green)]': o.status === 'paid',
                  }"
                >{{ o.status }}</span>
              </div>
              <div>
                <button
                  v-if="o.status === 'overdue' || o.status === 'due-soon' || o.status === 'upcoming'"
                  class="btn btn-pay btn-sm"
                  @click="openPay(o.bill_id, o.occurrence_id)"
                >
                  Mark Paid
                </button>
                <button
                  v-else-if="o.status === 'paid'"
                  class="btn btn-undo btn-sm"
                  @click="openEditPayment(o)"
                >
                  Edit Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <PaymentModal :open="payOpen" :bill="payingBill" @close="closePay()" @saved="load({ silent: true, preserveScroll: true })" />
  <EditPaymentModal
    :open="editOpen"
    :payment="editingPayment"
    @close="closeEditPayment()"
    @saved="load({ silent: true, preserveScroll: true })"
    @deleted="load({ silent: true, preserveScroll: true })"
  />
  <BillDetailModal :open="detailOpen" :bill-id="detailBillId" @close="closeDetail()" @changed="load({ silent: true, preserveScroll: true })" />
</template>

