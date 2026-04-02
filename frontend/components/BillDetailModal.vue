<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'
import BillModal from '~/components/BillModal.vue'

type Bill = {
  id: number
  name: string
  company?: string | null
  frequency: string
  due_day?: number | null
  next_date?: string | null
  amount?: number | null
  autopay?: 'Yes' | 'No'
  method?: string | null
  account?: string | null
  notes?: string | null
}

type Payment = {
  id: number
  bill_id: number
  paid_date: string
  amount?: number | null
  method?: string | null
  paid_by?: string | null
  confirm_num?: string | null
  notes?: string | null
}

type Details = {
  bill: Bill
  upcoming: string[]
  payments: Payment[]
}

const props = defineProps<{
  open: boolean
  billId: number | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const api = useApi()
const loading = ref(false)
const err = ref<string | null>(null)
const details = ref<Details | null>(null)
const modalBodyEl = ref<HTMLElement | null>(null)

const editOpen = ref(false)
const editingBill = ref<Bill | null>(null)

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function today() {
  return new Date(new Date().toDateString())
}

function statusForUpcomingDate(iso: string) {
  const t = today()
  const dt = new Date(iso + 'T00:00:00')
  const days = Math.round((dt.getTime() - t.getTime()) / 86400000)
  if (days < 0) return { badge: 'overdue', label: 'Overdue', right: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue` }
  if (days === 0) return { badge: 'due-soon', label: 'Due today', right: 'Due today!' }
  if (days <= 15) return { badge: 'due-soon', label: 'Due soon', right: `In ${days} day${days === 1 ? '' : 's'}` }
  return { badge: 'upcoming', label: 'Upcoming', right: `In ${days} days` }
}

const bill = computed(() => details.value?.bill || null)

async function load(options?: { preserveScroll?: boolean }) {
  if (!props.billId) return
  const preserveScroll = options?.preserveScroll === true
  const currentScrollTop = preserveScroll && modalBodyEl.value ? modalBodyEl.value.scrollTop : 0
  loading.value = true
  err.value = null
  try {
    details.value = await api.get<Details>(`/api/bills/${props.billId}/details`)
  } catch (e: any) {
    err.value = e?.message || 'Failed to load bill details'
  } finally {
    loading.value = false
    if (preserveScroll && modalBodyEl.value) {
      await nextTick()
      modalBodyEl.value.scrollTop = currentScrollTop
    }
  }
}

watch(
  () => [props.open, props.billId] as const,
  async ([isOpen, id]) => {
    if (!isOpen || !id) return
    await load()
  }
)

function openEdit() {
  if (!bill.value) return
  editingBill.value = { ...bill.value }
  editOpen.value = true
}
function closeEdit() {
  editOpen.value = false
  editingBill.value = null
}
async function afterEditSaved() {
  closeEdit()
  await load({ preserveScroll: true })
  emit('changed')
}
</script>

<template>
  <div
    class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]"
    :class="{ '!flex': open }"
    @click.self="emit('close')"
  >
    <div ref="modalBodyEl" class="max-h-[92vh] w-[calc(700px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div v-if="loading" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">Loading…</div>
      <div v-else-if="err" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">{{ err }}</div>
      <div v-else-if="!details" class="p-[calc(20px*var(--layout-scale-n)/var(--layout-scale-d))] text-center text-[1.3rem] italic text-[color:var(--ink-light)]">No details.</div>
      <div v-else>
        <div class="detail-header" id="detail-header">
          <div class="detail-bill-name">{{ details.bill.name }}</div>
          <div class="detail-meta">
            {{ details.bill.frequency }}
            <template v-if="details.bill.frequency === 'Monthly' && details.bill.due_day"> · Due day {{ details.bill.due_day }}</template>
            <template v-else-if="details.bill.next_date"> · Next: {{ fmtDate(details.bill.next_date) }}</template>
            <template v-if="details.bill.amount != null"> · {{ fmtMoney(details.bill.amount) }}</template>
            <template v-if="details.bill.autopay === 'Yes'"> · AUTO-PAY</template>
            <template v-if="details.bill.method"> · {{ details.bill.method }}</template>
            <template v-if="details.bill.account"><br />Account: {{ details.bill.account }}</template>
            <template v-if="details.bill.notes"><br />{{ details.bill.notes }}</template>
          </div>
        </div>

        <div class="detail-grid">
          <div>
            <div class="detail-section-title">Upcoming</div>
            <div v-if="!details.upcoming?.length" class="detail-empty">No upcoming dates found.</div>
            <div v-else>
              <div v-for="d in details.upcoming" :key="d" class="detail-upcoming-row">
                <div>
                  <strong>{{ fmtDate(d) }}</strong>
                  <span style="margin-left:8px" class="badge" :class="statusForUpcomingDate(d).badge">{{ statusForUpcomingDate(d).label }}</span>
                </div>
                <div style="color:var(--ink-light)">{{ statusForUpcomingDate(d).right }}</div>
              </div>
            </div>
          </div>

          <div>
            <div class="detail-section-title">Recent Payments</div>
            <div v-if="!details.payments?.length" class="detail-empty">No payments recorded yet.</div>
            <div v-else>
              <div v-for="p in details.payments" :key="p.id" class="detail-pay-row">
                <div class="mb-[2px] flex items-baseline justify-between gap-3">
                  <span class="font-semibold text-[color:var(--ink)]">{{ fmtDate(p.paid_date) }}</span>
                  <span class="whitespace-nowrap font-['DM_Serif_Display'] text-[1.5rem] text-[color:var(--green)]">{{ fmtMoney(p.amount) }}</span>
                </div>
                <div class="detail-pay-meta">
                  <span v-if="p.method">{{ p.method }}</span>
                  <span v-if="p.paid_by"> · Paid by: {{ p.paid_by }}</span>
                  <span v-if="p.confirm_num"> · Ref: {{ p.confirm_num }}</span>
                  <span v-if="p.notes"><br />{{ p.notes }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex justify-end gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="emit('close')">Close</button>
          <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)]" @click="openEdit()">Edit Bill</button>
        </div>
      </div>
    </div>
  </div>

  <BillModal :open="editOpen" :bill="editingBill" @close="closeEdit()" @saved="afterEditSaved()" />
</template>

