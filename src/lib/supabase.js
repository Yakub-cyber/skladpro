import { createClient } from '@supabase/supabase-js'

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
