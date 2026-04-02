<script setup lang="ts">
import { useHead } from '#imports'
import TopNav from '~/components/TopNav.vue'
import ConfirmModal from '~/components/ConfirmModal.vue'
import { useConfirm } from '~/composables/useConfirm'

const { open, options, accept, cancel } = useConfirm()

useHead({
  title: 'Bill Ledger',
  link: [
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
    },
  ],
})
</script>

<template>
  <div>
    <TopNav />
    <main>
      <slot />
    </main>

    <ConfirmModal :open="open" :options="options" @confirm="accept()" @cancel="cancel()" />
  </div>
</template>

