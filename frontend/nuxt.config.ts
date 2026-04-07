// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
      ]
    }
  },
  modules: ['@nuxtjs/tailwindcss'],
  css: [
    '~/assets/css/tailwind.css'
  ],
  runtimeConfig: {
    apiProxyTarget: process.env.NUXT_API_PROXY_TARGET || 'http://127.0.0.1:3001',
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api'
    }
  },
  nitro: {
    routeRules: {
      '/api/**': {
        proxy: `${process.env.NUXT_API_PROXY_TARGET || 'http://127.0.0.1:3001'}/**`
      }
    }
  }
})
