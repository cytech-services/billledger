<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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
const savingMethod = ref(false)

const paid_date = ref('')
const amount = ref('')
const method = ref('')
const methodSearch = ref('')
const methodPickerOpen = ref(false)
const methodPickerEl = ref<HTMLElement | null>(null)
const paymentMethods = ref<string[]>([])
const paid_by = ref('')
const confirm_num = ref('')
const notes = ref('')

const title = computed(() => (props.bill?.name ? `Record Payment — ${props.bill.name}` : 'Record Payment'))
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

function toNullableAmount(value: unknown) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function isoToday() {
  const t = new Date(new Date().toDateString())
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    paid_date.value = isoToday()
    amount.value = props.bill?.amount != null ? String(props.bill.amount) : ''
    method.value = props.bill?.method ? String(props.bill.method) : ''
    methodSearch.value = method.value
    methodPickerOpen.value = false
    paid_by.value = ''
    confirm_num.value = ''
    notes.value = ''
    await loadPaymentMethods()
  }
)

async function loadPaymentMethods() {
  try {
    paymentMethods.value = await api.get<string[]>('/api/payment-methods')
  } catch {
    paymentMethods.value = []
  }
}

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

async function save() {
  if (!props.bill?.id) return
  if (!paid_date.value) return
  saving.value = true
  try {
    await api.post('/api/payments', {
      bill_id: props.bill.id,
      occurrence_id: props.bill.occurrence_id ?? null,
      paid_date: paid_date.value,
      amount: toNullableAmount(amount.value),
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

