// ──────────────────────────────────────────────────────────────────────────
//  Shim после ухода с Supabase на собственный API-бэкенд (skladpro-backend).
//  Прямых обращений к supabase-js больше нет — весь транспорт в lib/api.js.
//  Оставлен, чтобы не менять множество импортов старого имени hasSupabase.
// ──────────────────────────────────────────────────────────────────────────
import { hasApi } from './api'

export const hasSupabase = hasApi

// recoveryTokens больше не собираются из URL: восстановление пароля
// перенесено в наш бэкенд (POST /v1/auth/password/* — будущий эндпоинт).
// Оставляем экспорт с null для обратной совместимости.
export const recoveryTokens = null

export const supabase = new Proxy(
	{},
	{
		get(_target, prop) {
			throw new Error(
				`[supabase-shim] прямой доступ к supabase.${String(prop)} больше не поддерживается — ` +
					'используйте lib/api.js (apiFetch, apiSale, apiSyncPull/Push и т.п.)',
			)
		},
	},
)
