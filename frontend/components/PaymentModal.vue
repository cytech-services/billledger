<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'

type BillLike = {
  id: number
  occurrence_id?: number | null
  name: string
  amount?: number | null
  method?: string | null
  company?: string | null
  frequency?: string | null
}

const props = defineProps<{
  open: boolean
  bill: BillLike | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const api = useApi()
const saving = ref(false)

const paid_date = ref('')
const amount = ref('')
const method = ref('')
const paid_by = ref('')
const confirm_num = ref('')
const notes = ref('')

const title = computed(() => (props.bill?.name ? `Record Payment — ${props.bill.name}` : 'Record Payment'))

function isoToday() {
  const t = new Date(new Date().toDateString())
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    paid_date.value = isoToday()
    amount.value = props.bill?.amount != null ? String(props.bill.amount) : ''
    method.value = props.bill?.method ? String(props.bill.method) : ''
    paid_by.value = ''
    confirm_num.value = ''
    notes.value = ''
  }
)

async function save() {
  if (!props.bill?.id) return
  if (!paid_date.value) return
  saving.value = true
  try {
    await api.post('/api/payments', {
      bill_id: props.bill.id,
      occurrence_id: props.bill.occurrence_id ?? null,
      paid_date: paid_date.value,
      amount: amount.value ? Number(amount.value) : null,
      method: method.value.trim(),
      paid_by: paid_by.value.trim(),
      confirm_num: confirm_num.value.trim(),
      notes: notes.value.trim(),
    })
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]"
    :class="{ '!flex': open }"
    @click.self="emit('close')"
  >
    <div class="max-h-[92vh] w-[calc(540px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div class="mb-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] font-['DM_Serif_Display'] text-[2.1rem]">{{ title }}</div>
      <div class="mb-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] rounded-lg bg-[color:var(--paper-dark)] px-[calc(15px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(11px*var(--layout-scale-n)/var(--layout-scale-d))] text-[1.3rem] leading-[1.6]">
        <strong>{{ bill?.name || 'Bill' }}</strong
        >{{ bill?.company ? ` — ${bill.company}` : '' }}<br />
        <span class="text-[1.2rem] text-[color:var(--ink-light)]">
          {{ bill?.frequency || '' }}{{ bill?.amount != null ? ` · $${Number(bill.amount).toFixed(2)}` : '' }}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div class="flex flex-col gap-[5px]">
          <label>Payment Date *</label>
          <input v-model="paid_date" type="date" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Amount ($)</label>
          <input v-model="amount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid With (method / card)</label>
          <input v-model="method" placeholder="e.g. Mastercard" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid By (person)</label>
          <input v-model="paid_by" placeholder="e.g. Tom, Sarah, Joint…" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Confirmation #</label>
          <input v-model="confirm_num" placeholder="Optional" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Notes</label>
          <textarea v-model="notes" placeholder="Optional" />
        </div>
      </div>

      <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex justify-end gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" :disabled="saving" @click="emit('close')">Cancel</button>
        <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)] disabled:opacity-60" :disabled="saving || !paid_date" @click="save()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Record Payment</span>
        </button>
      </div>
    </div>
  </div>
</template>

