<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'

type Bill = {
  id?: number
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
}

const props = defineProps<{
  open: boolean
  bill: Bill | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const api = useApi()
const saving = ref(false)

const name = ref('')
const company = ref('')
const frequency = ref('')
const dueDayOrNextDate = ref('')
const amount = ref('')
const autopay = ref<'Yes' | 'No'>('No')
const method = ref('')
const account = ref('')
const notes = ref('')
const customDates = ref<string[]>([])

const needsDate = computed(() => !['Monthly', 'Weekly', 'Custom', 'Estimated Tax (US/NY)'].includes(frequency.value))

const dayLabel = computed(() => {
  const map: Record<string, string> = {
    Monthly: 'Due Day of Month *',
    Weekly: 'Day of Week *',
    Quarterly: 'Next Due Date *',
    'Bi-Monthly': 'Next Due Date *',
    'Semi-Annual': 'Next Due Date *',
    Annual: 'Next Due Date *',
    'Bi-Weekly': 'Next Due Date *',
    'Estimated Tax (US/NY)': 'Schedule',
    Custom: '',
  }
  return map[frequency.value] || 'Due *'
})

const showDayField = computed(() => frequency.value !== 'Custom' && frequency.value !== 'Estimated Tax (US/NY)')
const showCustomDates = computed(() => frequency.value === 'Custom')

const title = computed(() => (props.bill?.id ? 'Edit Bill' : 'Add Bill'))

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const b = props.bill
    name.value = b?.name || ''
    company.value = b?.company || ''
    frequency.value = b?.frequency || ''
    autopay.value = (b?.autopay as any) || 'No'
    amount.value = b?.amount == null ? '' : String(b.amount)
    method.value = b?.method || ''
    account.value = b?.account || ''
    notes.value = b?.notes || ''
    customDates.value = []
    if (b?.frequency === 'Custom') {
      // For now we start blank; custom-date editing will be improved later.
      customDates.value = []
    }
    const nd = b?.next_date || ''
    const dd = b?.due_day != null ? String(b.due_day) : ''
    dueDayOrNextDate.value = needsDate.value ? nd : dd
  }
)

function addCustomDate() {
  customDates.value.push('')
}
function removeCustomDate(i: number) {
  if (!confirm('Remove this custom date?')) return
  customDates.value.splice(i, 1)
}

async function save() {
  if (!name.value.trim()) return
  if (!frequency.value) return
  if (frequency.value === 'Monthly' && !dueDayOrNextDate.value) return
  if (needsDate.value && !dueDayOrNextDate.value) return
  if (frequency.value === 'Custom' && !customDates.value.filter(Boolean).length) return

  const body: any = {
    name: name.value.trim(),
    company: company.value.trim(),
    frequency: frequency.value,
    due_day: frequency.value === 'Monthly' || frequency.value === 'Weekly' ? (dueDayOrNextDate.value ? Number(dueDayOrNextDate.value) : null) : null,
    next_date: needsDate.value ? dueDayOrNextDate.value : null,
    amount: amount.value ? Number(amount.value) : null,
    autopay: autopay.value,
    method: method.value.trim(),
    account: account.value.trim(),
    notes: notes.value.trim(),
    custom_dates: frequency.value === 'Custom' ? customDates.value.filter(Boolean) : [],
  }

  saving.value = true
  try {
    if (props.bill?.id) await api.put(`/api/bills/${props.bill.id}`, body)
    else await api.post('/api/bills', body)
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

      <div class="fgrid">
        <div class="fg full">
          <label>Bill Name *</label>
          <input v-model="name" placeholder="e.g. Rent" />
        </div>
        <div class="fg">
          <label>Company</label>
          <input v-model="company" placeholder="Optional" />
        </div>
        <div class="fg">
          <label>Frequency *</label>
          <select v-model="frequency">
            <option value="">Select…</option>
            <option>Monthly</option>
            <option>Bi-Monthly</option>
            <option>Quarterly</option>
            <option>Semi-Annual</option>
            <option>Annual</option>
            <option>Weekly</option>
            <option>Bi-Weekly</option>
            <option>Estimated Tax (US/NY)</option>
            <option>Custom</option>
          </select>
        </div>

        <div v-if="showDayField" class="fg">
          <label>{{ dayLabel }}</label>
          <input v-model="dueDayOrNextDate" :type="needsDate ? 'date' : 'number'" :placeholder="needsDate ? '' : 'e.g. 15'" />
          <div v-if="frequency === 'Estimated Tax (US/NY)'" class="hint" style="display:block">
            Due dates are fixed to Jan 15, Apr 15, Jun 15, and Sep 15 each year.
          </div>
        </div>

        <div v-if="showCustomDates" class="custom-dates-section visible">
          <label style="display:block;margin-bottom:10px">Custom Due Dates *</label>
          <div id="custom-dates-list">
            <div v-for="(d,i) in customDates" :key="i" class="custom-date-row">
              <input type="date" :value="d" @change="customDates[i] = ($event.target as HTMLInputElement).value" />
              <button type="button" class="btn btn-danger btn-sm" @click="removeCustomDate(i)">✕</button>
            </div>
          </div>
          <button type="button" class="cd-add-btn" @click="addCustomDate()">+ Add Date</button>
          <div class="hint" style="display:block;margin-top:10px">
            Add each specific date this bill is due. You can add as many dates as needed.
          </div>
        </div>

        <div class="fg">
          <label>Amount ($)</label>
          <input v-model="amount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="fg">
          <label>Auto-Pay?</label>
          <select v-model="autopay">
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
        <div class="fg full">
          <label>Usual Payment Method</label>
          <input v-model="method" placeholder="e.g. Mastercard" />
        </div>
        <div class="fg">
          <label>Account / Ref #</label>
          <input v-model="account" placeholder="Optional" />
        </div>
        <div class="fg full">
          <label>Notes / Reminders</label>
          <textarea v-model="notes" placeholder="Optional" />
        </div>
      </div>

      <div class="mfooter">
        <button class="btn btn-ghost" :disabled="saving" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="saving || !name.trim() || !frequency" @click="save()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Save Bill</span>
        </button>
      </div>
    </div>
  </div>
</template>

