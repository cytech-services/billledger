import { onMounted, onUnmounted, ref } from 'vue'

type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'billledger.theme'

function normalize(v: unknown): ThemePref {
  const s = String(v || '').toLowerCase()
  if (s === 'light' || s === 'dark' || s === 'system') return s
  return 'system'
}

function apply(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'dark') root.setAttribute('data-theme', 'dark')
  else if (pref === 'light') root.setAttribute('data-theme', 'light')
  else root.removeAttribute('data-theme')
}

export function useTheme() {
  const preference = ref<ThemePref>('system')
  let media: MediaQueryList | null = null
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

  function setPreference(next: string) {
    const v = normalize(next)
    preference.value = v
    localStorage.setItem(KEY, v)
    apply(v)
  }

  onMounted(() => {
    preference.value = normalize(localStorage.getItem(KEY))
    apply(preference.value)
    media = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = () => {
      if (preference.value === 'system') apply('system')
    }
    if (typeof media.addEventListener === 'function') media.addEventListener('change', mediaListener)
    else if (typeof media.addListener === 'function') media.addListener(mediaListener)
  })

  onUnmounted(() => {
    if (!media || !mediaListener) return
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', mediaListener)
    else if (typeof media.removeListener === 'function') media.removeListener(mediaListener)
  })

  return { preference, setPreference }
}

