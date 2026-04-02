import { useRuntimeConfig } from '#imports'

export function useApi() {
  const config = useRuntimeConfig()
  const base = String(config.public.apiBase || 'http://127.0.0.1:3001').replace(/\/$/, '')

  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return await $fetch<T>(`${base}${url}`, {
      method,
      body: body ?? undefined,
    })
  }

  return {
    get: <T>(url: string) => request<T>('GET', url),
    post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
    put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
    del: <T>(url: string) => request<T>('DELETE', url),
  }
}

