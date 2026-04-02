<script setup lang="ts">
type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'default'
}

const props = defineProps<{
  open: boolean
  options: ConfirmOptions | null
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <div
    class="fixed inset-0 z-[200] hidden items-center justify-center bg-[rgba(26,26,46,.52)] backdrop-blur-[3px]"
    :class="{ '!flex': props.open }"
    @click.self="emit('cancel')"
  >
    <div class="max-h-[92vh] w-[calc(540px*var(--layout-scale-n)/var(--layout-scale-d))] max-w-[96vw] overflow-y-auto rounded-[15px] bg-[color:var(--cream)] p-[calc(30px*var(--layout-scale-n)/var(--layout-scale-d))] shadow-[0_24px_60px_rgba(0,0,0,.18)]">
      <div class="mb-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] font-['DM_Serif_Display'] text-[2.1rem]">{{ props.options?.title || 'Confirm' }}</div>
      <div class="whitespace-pre-wrap text-[1.4rem] leading-[1.6] text-[color:var(--ink)]">
        {{ props.options?.message || '' }}
      </div>

      <div class="mt-[calc(22px*var(--layout-scale-n)/var(--layout-scale-d))] flex justify-end gap-[calc(9px*var(--layout-scale-n)/var(--layout-scale-d))] border-t border-[color:var(--border)] pt-[calc(18px*var(--layout-scale-n)/var(--layout-scale-d))]">
        <button class="rounded-lg border border-[color:var(--border)] px-[15px] py-2 text-[1.3rem] font-semibold text-[color:var(--ink-light)] transition-colors hover:bg-[color:var(--paper-dark)]" @click="emit('cancel')">
          {{ props.options?.cancelText || 'Cancel' }}
        </button>
        <button
          class="rounded-lg px-[15px] py-2 text-[1.3rem] font-semibold transition-colors"
          :class="props.options?.tone === 'danger' ? 'bg-[color:var(--red-light)] text-[color:var(--red)] hover:brightness-95' : 'bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent-dark)]'"
          @click="emit('confirm')"
        >
          {{ props.options?.confirmText || 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>

