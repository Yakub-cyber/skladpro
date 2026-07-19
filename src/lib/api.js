// ──────────────────────────────────────────────────────────────────────────
//  HTTP-клиент собственного бэкенда SkladPro (skladpro-backend) для веба.
//  Заменяет @supabase/supabase-js. Все операции через типизированные
//  эндпоинты /v1/*.
//
//  Токены:
//    • access — в памяти (короткий TTL ≈ 15 мин)
//    • refresh — в localStorage (webAuth-safe; ключ отличается от старого supabase)
//    • автоматический refresh при 401 (защищён от гонок мьютексом)
//    • grace-окно бэкенда (15 сек) прощает ретраи после потерянного ответа
// ──────────────────────────────────────────────────────────────────────────

export const API_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '')
export const hasApi = !!API_URL

const REFRESH_KEY = 'skladpro-refresh'
const COMPANY_KEY = 'skladpro-company'
const USER_KEY = 'skladpro-user'

let accessToken = null
let refreshToken = null
let currentCompanyId = null
let currentUser = null
let inflightRefresh = null

const authListeners = new Set()
function emitAuth(event) {
	for (const cb of authListeners) {
		try { cb(event, currentUser ? { user: currentUser, companyId: currentCompanyId } : null) } catch {}
	}
}

function readLocal(key) {
	try { return localStorage.getItem(key) } catch { return null }
}
function writeLocal(key, value) {
	try {
		if (value == null) localStorage.removeItem(key)
		else localStorage.setItem(key, value)
	} catch {}
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
export async function apiBootstrap() {
	if (!hasApi) return { session: null }
	refreshToken = readLocal(REFRESH_KEY)
	currentCompanyId = readLocal(COMPANY_KEY)
	const rawUser = readLocal(USER_KEY)
	if (rawUser) { try { currentUser = JSON.parse(rawUser) } catch {} }
	if (!refreshToken) return { session: null }
	const ok = await refreshPair()
	if (!ok) { await apiSignOut(); return { session: null } }
	return { session: { user: currentUser, companyId: currentCompanyId } }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function saveSession(res) {
	accessToken = res.accessToken
	refreshToken = res.refreshToken
	currentUser = res.user ? { id: res.user.id, email: res.user.email, name: res.user.name } : null
	writeLocal(REFRESH_KEY, refreshToken)
	if (currentUser) writeLocal(USER_KEY, JSON.stringify(currentUser))
	if (Array.isArray(res.memberships) && res.memberships.length > 0) {
		if (!currentCompanyId || !res.memberships.find(m => m.companyId === currentCompanyId)) {
			currentCompanyId = res.memberships[0].companyId
			writeLocal(COMPANY_KEY, currentCompanyId)
		}
	}
}

export async function apiSignUp(email, password, name) {
	if (!hasApi) return { ok: false, error: 'API_URL не настроен' }
	const res = await rawFetch('POST', '/v1/auth/register', { email: email.trim(), password, name })
	if (!res.ok) return { ok: false, error: humanAuthError(res) }
	await saveSession(res.body)
	emitAuth('SIGNED_IN')
	return { ok: true, user: res.body.user, memberships: res.body.memberships ?? [] }
}

export async function apiSignIn(email, password) {
	if (!hasApi) return { ok: false, error: 'API_URL не настроен' }
	const res = await rawFetch('POST', '/v1/auth/login', { email: email.trim(), password })
	if (!res.ok) return { ok: false, error: humanAuthError(res) }
	await saveSession(res.body)
	emitAuth('SIGNED_IN')
	return { ok: true, user: res.body.user, memberships: res.body.memberships ?? [] }
}

export async function apiSignOut() {
	if (refreshToken) { try { await rawFetch('POST', '/v1/auth/logout', { refreshToken }) } catch {} }
	accessToken = null
	refreshToken = null
	currentUser = null
	currentCompanyId = null
	writeLocal(REFRESH_KEY, null)
	writeLocal(COMPANY_KEY, null)
	writeLocal(USER_KEY, null)
	emitAuth('SIGNED_OUT')
}

export function getCompanyId() { return currentCompanyId }
export function getCurrentUser() { return currentUser }
export function getSession() {
	return currentUser ? { user: currentUser, companyId: currentCompanyId } : null
}
export function onAuthChange(cb) {
	authListeners.add(cb)
	return () => authListeners.delete(cb)
}

export async function setActiveCompany(companyId) {
	currentCompanyId = companyId
	writeLocal(COMPANY_KEY, companyId || null)
	emitAuth('COMPANY_CHANGED')
}

// ── Refresh (одна in-flight операция) ────────────────────────────────────────
async function refreshPair() {
	if (!refreshToken) return false
	if (inflightRefresh) return inflightRefresh
	inflightRefresh = (async () => {
		try {
			const res = await rawFetch('POST', '/v1/auth/refresh', { refreshToken })
			if (!res.ok) return false
			accessToken = res.body.accessToken
			refreshToken = res.body.refreshToken
			writeLocal(REFRESH_KEY, refreshToken)
			return true
		} catch {
			return false
		} finally {
			inflightRefresh = null
		}
	})()
	return inflightRefresh
}

async function rawFetch(method, path, body, headers = {}) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 30_000)
	try {
		const res = await fetch(API_URL + path, {
			method,
			headers: { 'content-type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
		})
		let json = null
		try { json = await res.json() } catch {}
		return { ok: res.ok, status: res.status, body: json, headers: res.headers }
	} finally {
		clearTimeout(timer)
	}
}

export async function apiFetch(method, path, body, opts = {}) {
	if (!hasApi) return { ok: false, status: 0, error: { code: 'NO_API', message: 'API_URL не настроен' } }
	const headers = { ...(opts.headers || {}) }
	if (currentCompanyId && !opts.skipCompany) headers['x-company-id'] = currentCompanyId
	if (accessToken) headers.authorization = `Bearer ${accessToken}`

	const res = await rawFetch(method, path, body, headers)
	if (res.status === 401 && refreshToken && !opts._retried) {
		const refreshed = await refreshPair()
		if (refreshed) return apiFetch(method, path, body, { ...opts, _retried: true })
		await apiSignOut()
	}
	if (!res.ok) return { ok: false, status: res.status, error: res.body?.error || { code: 'HTTP_' + res.status, message: 'HTTP ' + res.status } }
	return { ok: true, status: res.status, body: res.body }
}

// ── Высокоуровневые обёртки ──────────────────────────────────────────────────
export function apiGetMe() { return apiFetch('GET', '/v1/me', undefined, { skipCompany: true }) }
export function apiCreateCompany(name, userName) {
	return apiFetch('POST', '/v1/companies', { name, userName }, { skipCompany: true })
}
export function apiListMemberships() { return apiFetch('GET', '/v1/memberships', undefined, { skipCompany: true }) }

export function apiSyncPull({ since, table, limit } = {}) {
	const qs = new URLSearchParams()
	if (since != null) qs.set('since', String(since))
	if (table) qs.set('table', table)
	if (limit) qs.set('limit', String(limit))
	const url = '/v1/sync/pull' + (qs.toString() ? '?' + qs : '')
	return apiFetch('GET', url)
}
export function apiSyncPush(ops) { return apiFetch('POST', '/v1/sync/push', { ops }) }

export function apiGetSettings() { return apiFetch('GET', '/v1/settings') }
export function apiPutSettings(data) { return apiFetch('PUT', '/v1/settings', { data }) }

function withIdem(idemKey) { return { headers: { 'idempotency-key': idemKey } } }
export function apiSale(order, idemKey) { return apiFetch('POST', '/v1/sales', { order }, withIdem(idemKey)) }
export function apiDocument(document, idemKey) { return apiFetch('POST', '/v1/documents/post', { document }, withIdem(idemKey)) }
export function apiOrderStatus(orderId, status, idemKey) {
	return apiFetch('POST', `/v1/orders/${encodeURIComponent(orderId)}/status`, { status }, withIdem(idemKey))
}
export function apiReturn({ orderId, items, reason }, idemKey) {
	const body = { orderId }
	if (items) body.items = items
	if (reason) body.reason = reason
	return apiFetch('POST', '/v1/returns', body, withIdem(idemKey))
}

export function apiPinSet(employeeId, pin) { return apiFetch('POST', '/v1/employees/pin/set', { employeeId, pin }) }
export function apiPinVerify(employeeId, pin) { return apiFetch('POST', '/v1/employees/pin/verify', { employeeId, pin }) }

export function apiCustomerPayment(customerId, body, idemKey) {
	return apiFetch('POST', `/v1/customers/${encodeURIComponent(customerId)}/payments`, body, withIdem(idemKey))
}
export function apiMarkCodes(productId, body, idemKey) {
	return apiFetch('POST', `/v1/products/${encodeURIComponent(productId)}/mark-codes`, body, withIdem(idemKey))
}

// Password reset — эндпоинты не требуют авторизации.
// Realtime подписка на события компании через Server-Sent Events.
// Возвращает функцию отписки. Автопереподключение при разрыве.
export function subscribeEvents(onEvent) {
	if (!hasApi) return () => {}
	let stopped = false
	let controller = null
	let retryTimer = null
	let backoff = 1000

	const connect = async () => {
		if (stopped) return
		let token = accessToken
		if (!token) {
			const ok = await refreshPair()
			if (!ok || !accessToken) { schedule(); return }
			token = accessToken
		}
		const qs = new URLSearchParams({ access_token: token })
		controller = new AbortController()
		try {
			const res = await fetch(`${API_URL}/v1/events?${qs}`, {
				method: 'GET',
				headers: currentCompanyId ? { 'x-company-id': currentCompanyId } : {},
				signal: controller.signal,
			})
			if (res.status === 401) {
				const ok = await refreshPair()
				if (!ok) { schedule(); return }
				schedule(0)
				return
			}
			if (!res.ok || !res.body) { schedule(); return }
			backoff = 1000
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ''
			while (true) {
				const { done, value } = await reader.read()
				if (done) break
				buf += decoder.decode(value)
				let idx
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, idx)
					buf = buf.slice(idx + 2)
					if (chunk.startsWith(':')) continue
					const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'))
					if (!dataLine) continue
					try {
						const ev = JSON.parse(dataLine.slice(5).trim())
						onEvent?.(ev)
					} catch {}
				}
			}
		} catch { /* aborted / network — переподключаемся */ }
		if (!stopped) schedule()
	}

	const schedule = (delay = backoff) => {
		if (stopped) return
		if (retryTimer) clearTimeout(retryTimer)
		retryTimer = setTimeout(connect, delay)
		backoff = Math.min(backoff * 2, 30_000)
	}

	connect()
	return () => {
		stopped = true
		if (retryTimer) clearTimeout(retryTimer)
		if (controller) { try { controller.abort() } catch {} }
	}
}

export async function apiRequestPasswordReset(email) {
	const res = await rawFetch('POST', '/v1/auth/password/reset', { email: email.trim() })
	// Сервер всегда 200 (не выдаём user enumeration), но при 4xx (validation) сообщим.
	if (!res.ok) return { ok: false, error: res.body?.error?.message || `HTTP ${res.status}` }
	return { ok: true }
}
export async function apiApplyPasswordReset(token, newPassword) {
	const res = await rawFetch('POST', '/v1/auth/password/reset/confirm', { token, newPassword })
	if (!res.ok) return { ok: false, error: res.body?.error?.message || `HTTP ${res.status}` }
	return { ok: true }
}

function humanAuthError(res) {
	const code = res?.body?.error?.code
	const msg = res?.body?.error?.message || `HTTP ${res?.status ?? '?'}`
	if (code === 'DUPLICATE') return 'Этот email уже зарегистрирован'
	if (code === 'UNAUTHORIZED') return 'Неверный email или пароль'
	if (code === 'VALIDATION_ERROR') return 'Проверьте email и пароль (мин. 8 символов)'
	if (code === 'RATE_LIMITED') return 'Слишком много попыток, попробуйте через минуту'
	return msg
}

// Только для тестов
export function __resetApiForTests() {
	accessToken = null
	refreshToken = null
	currentUser = null
	currentCompanyId = null
	inflightRefresh = null
	authListeners.clear()
}
