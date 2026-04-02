<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useApi } from '~/composables/useApi'
import { useConfirm } from '~/composables/useConfirm'

type EditablePayment = {
  id: number
  bill_id: number
  bill_name?: string | null
  paid_date: string
  amount?: number | null
  method?: string | null
  paid_by?: string | null
  confirm_num?: string | null
  notes?: string | null
}

const props = defineProps<{
  open: boolean
  payment: EditablePayment | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
  (e: 'deleted'): void
}>()

const api = useApi()
const { confirm } = useConfirm()
const saving = ref(false)
const deleting = ref(false)
const savingMethod = ref(false)

const paidDate = ref('')
const amount = ref('')
const method = ref('')
const methodSearch = ref('')
const methodPickerOpen = ref(false)
const methodPickerEl = ref<HTMLElement | null>(null)
const paymentMethods = ref<string[]>([])
const paidBy = ref('')
const confirmNum = ref('')
const notes = ref('')

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
    paidDate.value = props.payment?.paid_date || ''
    amount.value = props.payment?.amount == null ? '' : String(props.payment.amount)
    method.value = props.payment?.method || ''
    methodSearch.value = method.value
    methodPickerOpen.value = false
    paidBy.value = props.payment?.paid_by || ''
    confirmNum.value = props.payment?.confirm_num || ''
    notes.value = props.payment?.notes || ''
    await loadPaymentMethods()
  }
)

function onDocClick(e: MouseEvent) {
  if (!methodPickerOpen.value) return
  const el = methodPickerEl.value
  if (!el) return
  const t = e.target as Node | null
  if (t && el.contains(t)) return
  methodPickerOpen.value = false
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

async function save() {
  if (!props.payment?.id || !paidDate.value) return
  saving.value = true
  try {
    await api.put(`/api/payments/${props.payment.id}`, {
      paid_date: paidDate.value,
      amount: toNullableAmount(amount.value),
      method: method.value.trim(),
      paid_by: paidBy.value.trim(),
      confirm_num: confirmNum.value.trim(),
      notes: notes.value.trim(),
    })
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}

async function removePayment() {
  if (!props.payment?.id || deleting.value) return
  const ok = await confirm({
    title: 'Remove payment?',
    message: 'Remove this payment record?',
    confirmText: 'Remove',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  deleting.value = true
  try {
    await api.del(`/api/payments/${props.payment.id}`)
    emit('deleted')
    emit('close')
  } finally {
    deleting.value = false
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
  <div class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]" :class="{ '!flex': open }" @click.self="emit('close')">
    <div class="max-h-[92vh] w-[calc(540px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div class="mb-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] font-['DM_Serif_Display'] text-[2.1rem]">Edit Payment</div>
      <div class="mb-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))] rounded-lg bg-[color:var(--paper-dark)] px-[calc(15px*var(--layout-scale-n)/var(--layout-scale-d))] py-[calc(11px*var(--layout-scale-n)/var(--layout-scale-d))] text-[1.3rem] leading-[1.6]">
        <strong>{{ payment?.bill_name || 'Payment' }}</strong><br />
        <span class="text-[1.2rem] text-[color:var(--ink-light)]">Payment ID: {{ payment?.id }}</span>
      </div>

      <div class="grid grid-cols-2 gap-[calc(14px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <div class="flex flex-col gap-[5px]">
          <label>Payment Date *</label>
          <input v-model="paidDate" type="date" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Amount ($)</label>
          <input v-model="amount" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid With (method / card)</label>
          <div ref="methodPickerEl" class="relative">
            <button type="button" class="inline-flex w-full items-center justify-between gap-[10px] rounded-[10px] border border-[color:var(--border)] bg-[color:var(--paper)] px-[11px] py-2 text-left text-[1.3rem] text-[color:var(--ink)] transition-colors hover:border-[color:var(--accent)]" @click="methodPickerOpen = !methodPickerOpen">
              <span class="truncate">{{ method || 'Select or search payment method' }}</span>
              <span class="text-[1.1rem] text-[color:var(--ink-light)]">▾</span>
            </button>
            <div v-if="methodPickerOpen" class="absolute left-0 top-[calc(100%+6px)] z-50 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--cream)] p-[10px] shadow-[0_8px_30px_var(--shadow)]" @click.stop>
              <div class="mb-2 flex items-center gap-2">
                <input
                  v-model="methodSearch"
                  class="flex-1 px-[10px] py-2 text-[1.3rem]"
                  placeholder="Search methods..."
                  @focus="methodPickerOpen = true"
                  @keydown.enter.prevent="canAddMethod ? addMethodFromSearch() : null"
                />
                <button v-if="method" type="button" class="rounded-lg border border-[color:var(--border)] px-[11px] py-[6px] text-[1.2rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="selectMethod('')">Clear</button>
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
                <button v-if="canAddMethod" type="button" class="w-full rounded-lg border border-dashed border-[color:var(--accent)] px-[10px] py-[7px] text-left text-[1.2rem] font-semibold text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent-light)] disabled:opacity-60" :disabled="savingMethod" @click="addMethodFromSearch()">
                  + Add "{{ methodSearch.trim() }}"
                </button>
                <div v-if="!filteredPaymentMethods.length && !canAddMethod" class="py-1 text-center text-[1.2rem] italic text-[color:var(--ink-light)]">No matching methods</div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Paid By (person)</label>
          <input v-model="paidBy" placeholder="e.g. Tom, Sarah, Joint…" />
        </div>
        <div class="flex flex-col gap-[5px]">
          <label>Confirmation #</label>
          <input v-model="confirmNum" placeholder="Optional" />
        </div>
        <div class="col-span-2 flex flex-col gap-[5px]">
          <label>Notes</label>
          <textarea v-model="notes" placeholder="Optional" />
        </div>
      </div>

      <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex items-center justify-between gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button class="rounded-lg bg-[color:var(--red-light)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--red)] transition-all hover:brightness-95 disabled:opacity-60" :disabled="saving || deleting" @click="removePayment()">Delete</button>
        <div class="flex gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))]">
          <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" :disabled="saving || deleting" @click="emit('close')">Cancel</button>
          <button class="rounded-lg bg-[color:var(--accent)] px-[15px] py-2 text-[1.3rem] font-semibold text-white transition-colors hover:bg-[color:var(--accent-dark)] disabled:opacity-60" :disabled="saving || deleting || !paidDate" @click="save()">
            <span v-if="saving" class="spinner"></span>
            <span v-else>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

