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
  <div class="overlay" :class="{ open: props.open }" @click.self="emit('cancel')">
    <div class="modal" style="max-width: 560px">
      <div class="modal-title">{{ props.options?.title || 'Confirm' }}</div>
      <div style="font-size: 1.4rem; color: var(--ink); line-height: 1.6; white-space: pre-wrap">
        {{ props.options?.message || '' }}
      </div>

      <div class="mfooter">
        <button class="btn btn-ghost" @click="emit('cancel')">
          {{ props.options?.cancelText || 'Cancel' }}
        </button>
        <button class="btn" :class="props.options?.tone === 'danger' ? 'btn-danger' : 'btn-primary'" @click="emit('confirm')">
          {{ props.options?.confirmText || 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>

