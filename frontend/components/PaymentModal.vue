<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'

type BillLike = {
  id: number
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
  <div class="overlay" :class="{ open }" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">{{ title }}</div>
      <div class="pay-info">
        <strong>{{ bill?.name || 'Bill' }}</strong
        >{{ bill?.company ? ` — ${bill.company}` : '' }}<br />
        <span style="color: var(--ink-light); font-size: 1.2rem">
          {{ bill?.frequency || '' }}{{ bill?.amount != null ? ` · $${Number(bill.amount).toFixed(2)}` : '' }}
        </span>
      </div>

      <div class="fgrid">
        <div class="fg">
          <label>Payment Date *</label>
          <input v-model="paid_date" type="date" />
        </div>
        <div class="fg">
          <label>Amount ($)</label>
          <input v-model="amount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="fg full">
          <label>Paid With (method / card)</label>
          <input v-model="method" placeholder="e.g. Mastercard" />
        </div>
        <div class="fg full">
          <label>Paid By (person)</label>
          <input v-model="paid_by" placeholder="e.g. Tom, Sarah, Joint…" />
        </div>
        <div class="fg">
          <label>Confirmation #</label>
          <input v-model="confirm_num" placeholder="Optional" />
        </div>
        <div class="fg full">
          <label>Notes</label>
          <textarea v-model="notes" placeholder="Optional" />
        </div>
      </div>

      <div class="mfooter">
        <button class="btn btn-ghost" :disabled="saving" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || !paid_date" @click="save()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Record Payment</span>
        </button>
      </div>
    </div>
  </div>
</template>

