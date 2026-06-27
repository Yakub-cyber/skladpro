import { createClient } from '@supabase/supabase-js'

// Захватываем recovery-токены из URL СРАЗУ при загрузке модуля — до того, как
// HashRouter перепишет hash (ссылка из письма сброса приходит как
// #access_token=...&type=recovery). Сохраняем и чистим URL.
export let recoveryTokens = null
if (typeof window !== 'undefined') {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (raw.includes('access_token') && raw.includes('type=recovery')) {
    const p = new URLSearchParams(raw)
    recoveryTokens = {
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
  }
}

// Подключение к Supabase. Ключи — из переменных окружения (.env / CI secrets).
// VITE_SUPABASE_KEY — публичный (publishable) ключ: безопасен в браузере,
// доступ к данным ограничивается политиками RLS на стороне базы.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: window.localStorage,
          storageKey: 'skladpro-auth',
        },
      })
    : null
export const hasSupabase = !!supabase
