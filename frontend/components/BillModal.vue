<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'
import { useConfirm } from '~/composables/useConfirm'

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
  month_day_combinations?: string[] | null
}

type BillPayload = {
  name: string
  company: string
  frequency: string
  due_day: number | null
  next_date: string | null
  amount: number | null
  autopay: 'Yes' | 'No'
  method: string
  account: string
  notes: string
  custom_dates: string[]
  month_day_combinations: string[]
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
const { confirm } = useConfirm()
const saving = ref(false)

const name = ref('')
const company = ref('')
const frequency = ref('')
const dueDayOrNextDate = ref('')
const amount = ref('')
const autopay = ref<'Yes' | 'No'>('No')
const method = ref('')
const methodSearch = ref('')
const methodPickerOpen = ref(false)
const savingMethod = ref(false)
const paymentMethods = ref<string[]>([])
const methodPickerEl = ref<HTMLElement | null>(null)
const account = ref('')
const notes = ref('')
const customDates = ref<string[]>([])
const monthDayCombinations = ref<string[]>([])

const needsDate = computed(() => !['Monthly', 'Weekly', 'Custom', 'Estimated Tax (US/NY)', 'Yearly (Month/Day)'].includes(frequency.value))

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
    'Yearly (Month/Day)': '',
    Custom: '',
  }
  return map[frequency.value] || 'Due *'
})

const showDayField = computed(
  () => frequency.value !== 'Custom' && frequency.value !== 'Estimated Tax (US/NY)' && frequency.value !== 'Yearly (Month/Day)'
)
const showCustomDates = computed(() => frequency.value === 'Custom')
const showMonthDayCombinations = computed(() => frequency.value === 'Yearly (Month/Day)')
const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1)
const filteredPaymentMethods = computed(() => {
  const q = methodSearch.value.trim().toLowerCase()
  if (!q) return paymentMethods.value
  return paymentMethods.value.filter((m) => String(m || '').toLowerCase().includes(q))
})
const canAddMethod = computed(() => {
  const q = methodSearch.value.trim()
  if (!q) return false
  return !paymentMethods.value.some((m) => m.toLowerCase() === q.toLowerCase())
})

const title = computed(() => (props.bill?.id ? 'Edit Bill' : 'Add Bill'))

async function loadPaymentMethods() {
  try {
    paymentMethods.value = await api.get<string[]>('/api/payment-methods')
  } catch {
    paymentMethods.value = []
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    const b = props.bill
    name.value = b?.name || ''
    company.value = b?.company || ''
    frequency.value = b?.frequency || ''
    autopay.value = b?.autopay === 'Yes' ? 'Yes' : 'No'
    amount.value = b?.amount == null ? '' : String(b.amount)
    method.value = b?.method || ''
    account.value = b?.account || ''
    notes.value = b?.notes || ''
    methodSearch.value = method.value
    methodPickerOpen.value = false
    customDates.value = []
    monthDayCombinations.value = []
    if (b?.frequency === 'Custom') {
      // For now we start blank; custom-date editing will be improved later.
      customDates.value = []
    }
    if (b?.frequency === 'Yearly (Month/Day)') {
      monthDayCombinations.value = Array.isArray(b.month_day_combinations) ? b.month_day_combinations.filter(Boolean) : []
    }
    const nd = b?.next_date || ''
    const dd = b?.due_day != null ? String(b.due_day) : ''
    dueDayOrNextDate.value = needsDate.value ? nd : dd
    await loadPaymentMethods()
  }
)

function selectMethod(name: string) {
  method.value = name
  methodSearch.value = name
  methodPickerOpen.value = false
}

async function addMethodFromSearch() {
  const name = methodSearch.value.trim()
  if (!name || savingMethod.value) return
  savingMethod.value = true
  try {
    await api.post('/api/payment-methods', { name })
    await loadPaymentMethods()
    selectMethod(name)
  } finally {
    savingMethod.value = false
  }
}

function onDocClick(e: MouseEvent) {
  if (!methodPickerOpen.value) return
  const el = methodPickerEl.value
  if (!el) return
  const t = e.target as Node | null
  if (t && el.contains(t)) return
  methodPickerOpen.value = false
}

function addCustomDate() {
  customDates.value.push('')
}
async function removeCustomDate(i: number) {
  const ok = await confirm({
    title: 'Remove custom date?',
    message: 'Remove this custom date?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  customDates.value.splice(i, 1)
}

function addMonthDayCombination() {
  monthDayCombinations.value.push('')
}
async function removeMonthDayCombination(i: number) {
  const ok = await confirm({
    title: 'Remove month/day?',
    message: 'Remove this month/day combination?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  monthDayCombinations.value.splice(i, 1)
}

function getMonthPart(value: string) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!m) return ''
  return String(Number(m[1]))
}

function getDayPart(value: string) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (!m) return ''
  return String(Number(m[2]))
}

function updateMonthDayCombination(index: number, part: 'month' | 'day', raw: string) {
  const current = monthDayCombinations.value[index] || ''
  const month = Number(part === 'month' ? raw : getMonthPart(current) || 1)
  const day = Number(part === 'day' ? raw : getDayPart(current) || 1)
  const mm = String(Math.min(Math.max(month, 1), 12)).padStart(2, '0')
  const dd = String(Math.min(Math.max(day, 1), 31)).padStart(2, '0')
  monthDayCombinations.value[index] = `${mm}-${dd}`
}

async function save() {
  if (!name.value.trim()) return
  if (!frequency.value) return
  if (frequency.value === 'Monthly' && !dueDayOrNextDate.value) return
  if (needsDate.value && !dueDayOrNextDate.value) return
  if (frequency.value === 'Custom' && !customDates.value.filter(Boolean).length) return
  if (frequency.value === 'Yearly (Month/Day)' && !monthDayCombinations.value.filter(Boolean).length) return

  const body: BillPayload = {
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
    month_day_combinations:
      frequency.value === 'Yearly (Month/Day)'
        ? monthDayCombinations.value.map((v) => String(v || '').trim()).filter(Boolean)
        : [],
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

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
})
</script>

<template>
  <div
    class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]"
    :class="{ '!flex': open }"
    @click.self="emit('close')"
  >
    <div class="max-h-[92vh] w-[calc(540px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div class="mb-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] font-['DM_Serif_Display'] text-[2.1rem]">{{ title }}</div>

      <div class="grid grid-cols-2 gap-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Bill Name *</label>
          <input v-model="name" placeholder="e.g. Rent" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Company</label>
          <input v-model="company" placeholder="Optional" />
        </div>
        <div class="flex flex-col gap-[5px]">
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
            <option>Yearly (Month/Day)</option>
            <option>Custom</option>
          </select>
        </div>

        <div v-if="showDayField" class="flex flex-col gap-[5px]">
          <label>{{ dayLabel }}</label>
          <input v-model="dueDayOrNextDate" :type="needsDate ? 'date' : 'number'" :placeholder="needsDate ? '' : 'e.g. 15'" />
          <div v-if="frequency === 'Estimated Tax (US/NY)'" class="mt-[3px] rounded-md bg-[color:var(--paper-dark)] px-[10px] py-[7px] text-[1.1rem] leading-[1.5] text-[color:var(--ink-light)]">
            Due dates are fixed to Jan 15, Apr 15, Jun 15, and Sep 15 each year.
          </div>
        </div>

        <div v-if="showCustomDates" class="col-span-2 rounded-[9px] border border-[color:var(--border)] bg-[color:var(--paper)] p-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <label class="mb-[10px] block">Custom Due Dates *</label>
          <div id="custom-dates-list">
            <div v-for="(d,i) in customDates" :key="i" class="mb-2 flex items-center gap-2">
              <input type="date" :value="d" @change="customDates[i] = ($event.target as HTMLInputElement).value" />
              <button type="button" class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="removeCustomDate(i)">✕</button>
            </div>
          </div>
          <button type="button" class="mt-1 inline-flex w-auto items-center gap-[5px] rounded-[7px] border border-dashed border-[color:var(--accent)] px-3 py-1.5 text-[1.2rem] font-semibold text-[color:var(--accent)] transition-all hover:bg-[color:var(--accent-light)]" @click="addCustomDate()">+ Add Date</button>
          <div class="mt-[10px] rounded-md bg-[color:var(--paper-dark)] px-[10px] py-[7px] text-[1.1rem] leading-[1.5] text-[color:var(--ink-light)]">
            Add each specific date this bill is due. You can add as many dates as needed.
          </div>
        </div>

        <div v-if="showMonthDayCombinations" class="col-span-2 rounded-[9px] border border-[color:var(--border)] bg-[color:var(--paper)] p-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <label class="mb-[10px] block">Yearly Month/Day Combinations *</label>
          <div>
            <div v-for="(md,i) in monthDayCombinations" :key="i" class="mb-2 flex items-center gap-2">
              <select class="w-[48%]" :value="getMonthPart(md)" @change="updateMonthDayCombination(i, 'month', ($event.target as HTMLSelectElement).value)">
                <option value="">Month</option>
                <option v-for="m in monthOptions" :key="m" :value="String(m)">{{ new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) }}</option>
              </select>
              <select class="w-[40%]" :value="getDayPart(md)" @change="updateMonthDayCombination(i, 'day', ($event.target as HTMLSelectElement).value)">
                <option value="">Day</option>
                <option v-for="d in dayOptions" :key="d" :value="String(d)">{{ d }}</option>
              </select>
              <button type="button" class="rounded-lg bg-[color:var(--red-light)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95" @click="removeMonthDayCombination(i)">✕</button>
            </div>
          </div>
          <button type="button" class="mt-1 inline-flex w-auto items-center gap-[5px] rounded-[7px] border border-dashed border-[color:var(--accent)] px-3 py-1.5 text-[1.2rem] font-semibold text-[color:var(--accent)] transition-all hover:bg-[color:var(--accent-light)]" @click="addMonthDayCombination()">+ Add Month/Day</button>
          <div class="mt-[10px] rounded-md bg-[color:var(--paper-dark)] px-[10px] py-[7px] text-[1.1rem] leading-[1.5] text-[color:var(--ink-light)]">
            Pick month and day for each yearly due date. You can add multiple combinations.
          </div>
        </div>

        <div class="flex flex-col gap-[5px]">
          <label>Amount ($)</label>
          <input v-model="amount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Auto-Pay?</label>
          <select v-model="autopay">
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Usual Payment Method</label>
          <div ref="methodPickerEl" class="relative">
            <button
              type="button"
              class="inline-flex w-full items-center justify-between gap-[10px] rounded-[10px] border border-[color:var(--border)] bg-[color:var(--paper)] px-[11px] py-2 text-left text-[1.3rem] text-[color:var(--ink)] transition-colors hover:border-[color:var(--accent)]"
              @click="methodPickerOpen = !methodPickerOpen"
            >
              <span class="truncate">{{ method || 'Select or search payment method' }}</span>
              <span class="text-[1.1rem] text-[color:var(--ink-light)]">▾</span>
            </button>
            <div
              v-if="methodPickerOpen"
              class="absolute left-0 top-[calc(100%+6px)] z-50 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--cream)] p-[10px] shadow-[0_8px_30px_var(--shadow)]"
              @click.stop
            >
              <div class="mb-2 flex items-center gap-2">
                <input
                  v-model="methodSearch"
                  class="flex-1 px-[10px] py-2 text-[1.3rem]"
                  placeholder="Search methods..."
                  @focus="methodPickerOpen = true"
                  @keydown.enter.prevent="canAddMethod ? addMethodFromSearch() : null"
                />
                <button
                  v-if="method"
                  type="button"
                  class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]"
                  @click="selectMethod('')"
                >Clear</button>
              </div>
              <div class="max-h-[220px] space-y-1 overflow-auto pr-1">
                <button
                  v-for="m in filteredPaymentMethods"
                  :key="m"
                  type="button"
                  class="flex w-full items-center justify-between rounded-lg border px-[8px] py-[7px] text-left text-[1.28rem] transition-colors"
                  :class="method === m ? 'border-[color:var(--accent)] bg-[color:var(--accent-light)]' : 'border-transparent hover:border-[color:var(--border)] hover:bg-[color:var(--paper-dark)]'"
                  @click="selectMethod(m)"
                >
                  <span class="truncate">{{ m }}</span>
                  <span v-if="method === m" class="ml-2 shrink-0 text-[1.1rem] font-semibold text-[color:var(--accent-dark)]">Selected</span>
                </button>
                <button
                  v-if="canAddMethod"
                  type="button"
                  class="w-full rounded-lg border border-dashed border-[color:var(--accent)] px-[10px] py-[7px] text-left text-[1.2rem] font-semibold text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent-light)] disabled:opacity-60"
                  :disabled="savingMethod"
                  @click="addMethodFromSearch()"
                >
                  + Add "{{ methodSearch.trim() }}"
                </button>
                <div v-if="!filteredPaymentMethods.length && !canAddMethod" class="py-1 text-center text-[1.2rem] italic text-[color:var(--ink-light)]">No matching methods</div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Account / Ref #</label>
          <input v-model="account" placeholder="Optional" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Notes / Reminders</label>
          <textarea v-model="notes" placeholder="Optional" />
        </div>
      </div>

      <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex justify-end gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" :disabled="saving" @click="emit('close')">Cancel</button>
        <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)] disabled:opacity-60" :disabled="saving || !name.trim() || !frequency" @click="save()">
          <span v-if="saving" class="spinner"></span>
          <span v-else>Save Bill</span>
        </button>
      </div>
    </div>
  </div>
</template>

