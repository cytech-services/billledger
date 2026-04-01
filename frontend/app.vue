<script setup>
import { onMounted } from 'vue';
import { useHead, useRuntimeConfig } from '#imports';

const config = useRuntimeConfig();

useHead({
  title: 'Bill Ledger',
  link: [
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap'
    },
    { rel: 'stylesheet', href: '/legacy.css' }
  ],
  script: [{ src: '/bill-ledger.js', defer: true }]
});

onMounted(async () => {
  const html = await $fetch('/legacy-markup.html');
  const root = document.getElementById('legacy-root');
  if (!root) return;

  root.innerHTML = html;

  window.BILLLEDGER_API_BASE = config.public.apiBase;
  window.BillLedgerApp?.init();
});
</script>

<template>
  <div id="legacy-root" />
</template>
