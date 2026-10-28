// ──────────────────────────────────────────────────────────────────────────
//  HTTP-клиент собственного бэкенда SkladPro (skladpro-backend) для веба.
//  Заменяет @supabase/supabase-js. Все операции через типизированные
//  эндпоинты /v1/*.
//
//  Токены:
//    • access — в памяти (короткий TTL ≈ 15 мин)
//    • refresh — в sessionStorage отдельной вкладки
//    • автоматический refresh при 401 (защищён от гонок мьютексом)
//    • grace-окно бэкенда (15 сек) прощает ретраи после потерянного ответа
// ──────────────────────────────────────────────────────────────────────────

export const API_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '')
export const hasApi = !!API_URL
import { pushEvent } from '../lib/diagRing'

const _crypto = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto : null
export function traceId() {
  return _crypto ? _crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// Auth state is tab-local. A company switch in one tab cannot rotate another
// tab's current company or replace its user's credentials.
const REFRESH_KEY = 'skladpro-v2-refresh'
const COMPANY_KEY = 'skladpro-v2-company'
const USER_KEY = 'skladpro-v2-user'
const SESSION_KEY = 'skladpro-v3-session'
const ENDED_PREFIX = 'skladpro-v3-ended:'
const LOGOUT_PREFIX = 'skladpro-v2-logout:'
const CONTEXT_PREFIX = 'skladpro-v2-context:'
const noticeSource = traceId()
let authChannel = null
let sessionEnded = false
let authConsistencyError = null
const seenNotices = new Set()
let sessionRecord = null
let pageSuspended = false
let resumeAllowed = false
export function getAuthConsistencyError() { return authConsistencyError }
function reportConsistency(error) {
  authConsistencyError = error
  pushEvent('auth_sync_error', { error })
  emitAuth('AUTH_SYNC_ERROR')
}
function notifyTabs(type, userId, companyId) {
  const notice = { type, userId, companyId, source: noticeSource, id: traceId() }
  let broadcast = false, stored = false
  try { if (authChannel) { authChannel.postMessage(notice); broadcast = true } } catch (e) { reportConsistency('BroadcastChannel: ' + e.message) }
  try {
    localStorage.setItem((type === 'LOGOUT' ? LOGOUT_PREFIX : CONTEXT_PREFIX) + userId, JSON.stringify(notice))
    stored = true
  } catch (e) { reportConsistency('Уведомление сессии не записано: ' + e.message) }
  if (!broadcast && !stored) reportConsistency('Другие вкладки могли не получить уведомление сессии. Завершите их сессии вручную.')
  return broadcast || stored
}
function clearSession(reason = 'SESSION_ENDED') {
  sessionEnded = true
  resumeAllowed = false
  // Persist revocation before clearing credentials. Neither network success nor
  // deleting sessionStorage is required for the local session to end.
  if (sessionRecord) {
    try {
      localStorage.setItem(ENDED_PREFIX + sessionRecord.id, 'ended')
      if (localStorage.getItem(ENDED_PREFIX + sessionRecord.id) !== 'ended') throw new Error('read-back failed')
    } catch (e) { reportConsistency('Признак завершения сессии не записан: ' + e.message) }
    persistSessionRecord({ ...sessionRecord, state: 'ended' })
  }
  invalidate(); accessToken = null; refreshToken = null; currentUser = null; currentCompanyId = null
  writeLocal(REFRESH_KEY, null); writeLocal(USER_KEY, null); writeLocal(COMPANY_KEY, null)
  emitAuth('SIGNED_OUT', { reason })
  if (authConsistencyError) emitAuth('AUTH_SYNC_ERROR')
}
function receiveNotice(notice) {
  if (!notice || notice.source === noticeSource || seenNotices.has(notice.id) || !currentUser || notice.userId !== currentUser.id) return
  if (notice.id) { seenNotices.add(notice.id); if (seenNotices.size > 256) seenNotices.delete(seenNotices.values().next().value) }
  if (notice.type === 'LOGOUT') clearSession()
  // A peer switch is informational. Each tab retains its pinned company and generation.
  if (notice.type === 'CONTEXT_CHANGED') emitAuth('PEER_CONTEXT_CHANGED')
}
function connectAuthChannel() {
  if (authChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  try {
    authChannel = new BroadcastChannel('skladpro-auth-v2')
    authChannel.onmessage = (event) => receiveNotice(event.data)
    authChannel.unref?.()
  } catch (e) { reportConsistency('BroadcastChannel недоступен: ' + e.message) }
}

let accessToken = null
let refreshToken = null
let currentCompanyId = null
let currentUser = null
let inflightRefresh = null
let sessionGeneration = 0
let refreshRejected = false
export function getAuthContext() {
  return Object.freeze({ userId: currentUser?.id || null, companyId: currentCompanyId, generation: sessionGeneration, sessionId: sessionRecord?.id || null })
}
export function isAuthContextCurrent(context) {
  return !!context && context.generation === sessionGeneration && context.userId === (currentUser?.id || null) && context.companyId === currentCompanyId && context.sessionId === (sessionRecord?.id || null)
}
const staleResult = () => ({ ok: false, status: 0, error: { code: 'CONTEXT_CHANGED', message: 'Контекст сессии изменился; повторная отправка остановлена' } })
function invalidate() { sessionGeneration++; inflightRefresh = null }
function beginAuth() {
  connectAuthChannel(); sessionEnded = false; authConsistencyError = null
  pageSuspended = false
  invalidate(); accessToken = null; refreshToken = null; currentUser = null; currentCompanyId = null
  sessionRecord = null
  resumeAllowed = false
  writeLocal(SESSION_KEY, null)
  writeLocal(REFRESH_KEY, null); writeLocal(USER_KEY, null); writeLocal(COMPANY_KEY, null)
  emitAuth('AUTH_CHANGING')
}

const authListeners = new Set()
function emitAuth(event, metadata) {
	for (const cb of authListeners) {
		try { cb(event, currentUser ? { user: currentUser, companyId: currentCompanyId } : null, metadata) } catch {}
	}
}

function readLocal(key) {
	try { return sessionStorage.getItem(key) } catch { return null }
}
function writeLocal(key, value) {
	try {
		if (value == null) sessionStorage.removeItem(key)
		else sessionStorage.setItem(key, value)
		if (sessionStorage.getItem(key) !== (value == null ? null : value)) throw new Error('read-back failed')
		return true
	} catch (e) { resumeAllowed = false; reportConsistency('Хранилище сессии недоступно: ' + e.message); return false }
}

function persistSessionRecord(record) {
  try {
    const encoded = JSON.stringify(record)
    sessionStorage.setItem(SESSION_KEY, encoded)
    if (sessionStorage.getItem(SESSION_KEY) !== encoded) throw new Error('read-back failed')
    sessionRecord = record
    return true
  } catch (e) { reportConsistency('Состояние сессии не сохранено; потребуется новый вход: ' + e.message); return false }
}
function sessionMayResume(record) {
  try {
    return record?.id && record.userId && record.state === 'resume'
      && localStorage.getItem(ENDED_PREFIX + record.id) === null
      && localStorage.getItem(LOGOUT_PREFIX + record.userId) === record.logoutStamp
  } catch (e) { reportConsistency('Проверка завершения сессии недоступна: ' + e.message); return false }
}
function prepareResume(event = {}) {
  if (sessionEnded || !resumeAllowed || !currentUser || !sessionRecord || sessionRecord.state !== 'running') return
  const candidate = { ...sessionRecord, state: 'resume' }
  // BFCache preserves this instance: leave its durable fence closed. Only a
  // departing instance may hand a permit to the next bootstrap.
  if (!event.persisted && sessionMayResume(candidate)) persistSessionRecord(candidate)
  // No late refresh/401 is allowed to mutate the session after granting a permit.
  pageSuspended = true
  if (!event.persisted) invalidate()
}
// While a tab is running, its durable record is deliberately NOT resumable.
// A graceful page exit grants a one-use resume permit. Bootstrap consumes it
// before reading credentials. If all writes/deletes fail at logout, the old
// running record still fails closed after reload. Crashes require a new login.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', prepareResume)
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    if (sessionEnded || !sessionRecord) { pageSuspended = false; return }
    if (!sessionMayResume({ ...sessionRecord, state: 'resume' }) || !persistSessionRecord({ ...sessionRecord, state: 'running' })) clearSession()
    pageSuspended = false
  })
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
export async function apiBootstrap() {
	if (!hasApi) return { session: null }
	connectAuthChannel()
	if (sessionEnded) return { session: null }
	invalidate()
	accessToken = null; currentUser = null
	const epoch = sessionGeneration
	let savedRecord = null
	try { savedRecord = JSON.parse(readLocal(SESSION_KEY)) } catch { /* legacy/corrupt credentials require explicit login */ }
	if (!sessionMayResume(savedRecord) || !persistSessionRecord({ ...savedRecord, state: 'running' })) {
		if (readLocal(REFRESH_KEY)) reportConsistency('Автовосстановление сессии запрещено. Войдите заново; локальные операции сохранены.')
		// This is bootstrap cleanup, not a new logout of the just-captured invitation.
		clearSession('BOOTSTRAP_RESET')
		return { session: null }
	}
	refreshToken = readLocal(REFRESH_KEY)
	currentCompanyId = readLocal(COMPANY_KEY)
	const rawUser = readLocal(USER_KEY)
	if (rawUser) { try { currentUser = JSON.parse(rawUser) } catch {} }
	if (currentUser?.id !== sessionRecord.userId) { clearSession('BOOTSTRAP_RESET'); return { session: null } }
	if (!refreshToken) return { session: null }
	resumeAllowed = true
	const ok = await refreshPair()
	if (epoch !== sessionGeneration) return { session: null }
	if (!ok) {
		if (refreshRejected) await apiSignOut()
		return { session: null, offline: !refreshRejected }
	}
	return { session: { user: currentUser, companyId: currentCompanyId } }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function saveSession(res) {
	// A successful login always gets a new local identity, even for the same user.
	let logoutStamp = null
	try { logoutStamp = localStorage.getItem(LOGOUT_PREFIX + res.user?.id) } catch (e) { reportConsistency('История завершения сессий недоступна: ' + e.message) }
	sessionRecord = { id: traceId(), userId: res.user?.id, state: 'running', logoutStamp }
	if (!persistSessionRecord(sessionRecord)) { sessionRecord = null; sessionEnded = true; return false }
	accessToken = res.accessToken
	refreshToken = res.refreshToken
	currentUser = res.user ? { id: res.user.id, email: res.user.email, name: res.user.name } : null
	let saved = writeLocal(REFRESH_KEY, refreshToken)
	if (currentUser) saved = writeLocal(USER_KEY, JSON.stringify(currentUser)) && saved
	if (Array.isArray(res.memberships) && res.memberships.length > 0) {
		if (!currentCompanyId || !res.memberships.find(m => m.companyId === currentCompanyId)) {
			currentCompanyId = res.memberships[0].companyId
			saved = writeLocal(COMPANY_KEY, currentCompanyId) && saved
		}
	}
	if (!saved) { clearSession(); return false }
	resumeAllowed = true
	return true
}

export async function apiSignUp(email, password, name, inviteToken) {
	if (!hasApi) return { ok: false, error: 'API_URL не настроен' }
	beginAuth()
	const epoch = sessionGeneration
	const body = { email: email.trim(), password, name }
	if (inviteToken) body.inviteToken = inviteToken
	const res = await rawFetch('POST', '/v1/auth/register', body)
	if (epoch !== sessionGeneration) return staleResult()
	if (!res.ok) return { ok: false, error: humanAuthError(res) }
	if (!await saveSession(res.body)) return { ok: false, error: authConsistencyError }
	if (epoch !== sessionGeneration) return staleResult()
	emitAuth('SIGNED_IN')
	return { ok: true, user: res.body.user, memberships: res.body.memberships ?? [] }
}

export async function apiSignIn(email, password) {
	if (!hasApi) return { ok: false, error: 'API_URL не настроен' }
	beginAuth()
	const epoch = sessionGeneration
	const res = await rawFetch('POST', '/v1/auth/login', { email: email.trim(), password })
	if (epoch !== sessionGeneration) return staleResult()
	if (!res.ok) return { ok: false, error: humanAuthError(res) }
	if (!await saveSession(res.body)) return { ok: false, error: authConsistencyError }
	if (epoch !== sessionGeneration) return staleResult()
	emitAuth('SIGNED_IN')
	return { ok: true, user: res.body.user, memberships: res.body.memberships ?? [] }
}

export async function apiSignOut() {
	if (pageSuspended) return staleResult() // BFCache must consume its permit on pageshow first.
	const oldRefresh = refreshToken, oldUser = currentUser?.id
	clearSession()
	const delivered = oldUser ? notifyTabs('LOGOUT', oldUser, null) : true
	if (oldRefresh) { try { await rawFetch('POST', '/v1/auth/logout', { refreshToken: oldRefresh }) } catch {} }
	return delivered ? { ok: true } : { ok: false, error: authConsistencyError }
}

// Logout propagates only to tabs of the same user; company selection stays local.
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (!currentUser) return
  if (event.key !== LOGOUT_PREFIX + currentUser.id && event.key !== CONTEXT_PREFIX + currentUser.id) return
  if (event.newValue) {
    try { receiveNotice(JSON.parse(event.newValue)); return } catch { /* old logout marker */ }
  }
  if (event.key === LOGOUT_PREFIX + currentUser.id) clearSession()
})

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
	if (companyId === currentCompanyId) return { ok: true }
	if (!currentUser) return staleResult()
	const original = getAuthContext()
	const memberships = await apiListMemberships()
	if (!isAuthContextCurrent(original)) return staleResult()
	if (!memberships.ok) return memberships
	if (!(memberships.body?.memberships || []).some((m) => m.companyId === companyId)) {
		return { ok: false, status: 403, error: { code: 'FORBIDDEN', message: 'Нет доступа к компании' } }
	}
	// Preserve a rotated refresh token before invalidating company context.
	// Logout/new login still invalidate immediately and discard late credentials.
	if (inflightRefresh) await inflightRefresh
	if (!isAuthContextCurrent(original)) return staleResult()
	invalidate()
	currentCompanyId = companyId
	writeLocal(COMPANY_KEY, companyId || null)
	emitAuth('COMPANY_CHANGED')
	notifyTabs('CONTEXT_CHANGED', currentUser.id, companyId)
	return { ok: true }
}

// ── Refresh (одна in-flight операция) ────────────────────────────────────────
async function refreshPair() {
	if (sessionEnded || pageSuspended || !refreshToken) return false
	if (inflightRefresh) return inflightRefresh
	const epoch = sessionGeneration, token = refreshToken
	refreshRejected = false
	const pending = (async () => {
		try {
			const res = await rawFetch('POST', '/v1/auth/refresh', { refreshToken: token })
			if (epoch !== sessionGeneration || sessionEnded || pageSuspended) return false
			if (!res.ok) { refreshRejected = res.status === 401 || res.status === 403; return false }
			accessToken = res.body.accessToken
			refreshToken = res.body.refreshToken
			writeLocal(REFRESH_KEY, refreshToken)
			return true
		} catch {
			return false
		} finally {
			if (epoch === sessionGeneration) inflightRefresh = null
		}
	})()
	inflightRefresh = pending
	return pending
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
	if (sessionEnded || pageSuspended) return staleResult()
	const context = opts.context || getAuthContext()
	if (!isAuthContextCurrent(context)) return staleResult()
	if (!context.userId) return staleResult()
	if (!opts.skipCompany && (!context.userId || !context.companyId)) return staleResult()
	const headers = { ...(opts.headers || {}) }
	if (context.companyId && !opts.skipCompany) headers['x-company-id'] = context.companyId
	if (accessToken) headers.authorization = `Bearer ${accessToken}`
	if (!headers['x-trace-id']) headers['x-trace-id'] = traceId()

	const res = await rawFetch(method, path, body, headers)
	// A confirmed write is returned to its captured outbox partition. A stale
	// failure must never trigger refresh/retry with the next user's credentials.
	if (!isAuthContextCurrent(context) && !res.ok) return staleResult()
	if (res.status === 401 && refreshToken && !opts._retried) {
		const refreshed = await refreshPair()
		if (!isAuthContextCurrent(context)) return staleResult()
		if (refreshed) return apiFetch(method, path, body, { ...opts, context, _retried: true })
		if (refreshRejected) await apiSignOut()
	}
	const tid = res.headers?.get?.('x-trace-id') || headers['x-trace-id']
	if (!res.ok) return { ok: false, status: res.status, error: res.body?.error || { code: 'HTTP_' + res.status, message: 'HTTP ' + res.status }, traceId: tid }
	return { ok: true, status: res.status, body: res.body, traceId: tid }
}

// ── Высокоуровневые обёртки ──────────────────────────────────────────────────
export function apiGetMe() { return apiFetch('GET', '/v1/me', undefined, { skipCompany: true }) }
export function apiCreateCompany(name, userName) {
	return apiFetch('POST', '/v1/companies', { name, userName }, { skipCompany: true })
}
export function apiListMemberships() { return apiFetch('GET', '/v1/memberships', undefined, { skipCompany: true }) }

export function apiStockReconcile(request, context = getAuthContext()) {
	return apiFetch('POST', '/v1/stock/reconcile', request, { context })
}

export function apiSyncPull({ since, table, limit, context } = {}) {
	const qs = new URLSearchParams()
	if (since != null) qs.set('since', String(since))
	if (table) qs.set('table', table)
	if (limit) qs.set('limit', String(limit))
	const url = '/v1/sync/pull' + (qs.toString() ? '?' + qs : '')
	return apiFetch('GET', url, undefined, { context })
}
export function apiSyncPush(ops, context) { return apiFetch('POST', '/v1/sync/push', { ops }, { context }) }

export function apiGetSettings() { return apiFetch('GET', '/v1/settings') }
export function apiPutSettings(data, context) { return apiFetch('PUT', '/v1/settings', { data }, { context }) }

function withIdem(idemKey, context) { return { context, headers: { 'idempotency-key': idemKey } } }
export function apiSale(order, idemKey, context) { return apiFetch('POST', '/v1/sales', order?.contractVersion === 2 ? order : { order }, withIdem(idemKey, context)) }
export function apiDocument(document, idemKey, context) { return apiFetch('POST', '/v1/documents/post', { document }, withIdem(idemKey, context)) }
export function apiOrderStatus(orderId, status, idemKey, context) {
	return apiFetch('POST', `/v1/orders/${encodeURIComponent(orderId)}/status`, typeof status === 'object' ? status : { status }, withIdem(idemKey, context))
}
export function apiReturn({ orderId, items, reason, contractVersion, returnId }, idemKey, context) {
	const body = { orderId }
	if (contractVersion !== undefined) body.contractVersion = contractVersion
	if (returnId !== undefined) body.returnId = returnId
	if (items) body.items = items
	if (reason) body.reason = reason
	return apiFetch('POST', '/v1/returns', body, withIdem(idemKey, context))
}

export function apiEnsureMe(employee, context) { return apiFetch('POST', '/v1/employees/me', employee, { context }) }
export function apiPinSet(employeeId, pin) { return apiFetch('POST', '/v1/employees/pin/set', { employeeId, pin }) }
export function apiPinVerify(employeeId, pin) { return apiFetch('POST', '/v1/employees/pin/verify', { employeeId, pin }) }

// ── Subscription / billing (B2) ─────────────────────────────────────────────
// Сервер — источник истины по плану и trial-окну (раньше жило в localStorage
// и обходилось очисткой). apiGetSubscription() возвращает { subscription,
// effectivePlan, limits, trialDaysLeft, plans } — этой структуры хватает,
// чтобы Subscription.jsx показал статус и CTA «Оплатить».
export function apiGetSubscription(context) { return apiFetch('GET', '/v1/subscription', undefined, { context }) }
export function apiCreateCheckout(plan, periodMonths = 1) {
	return apiFetch('POST', '/v1/subscription/checkout', { plan, periodMonths })
}

// ── API-ключи и Webhooks (B4) ───────────────────────────────────────────────
// D3 создавал их локально в settings.apiKeys/settings.webhooks. Теперь —
// на сервере. Секрет ключа отдаётся клиенту РОВНО ОДИН РАЗ при создании,
// потом только keyPreview.
export function apiListApiKeys() { return apiFetch('GET', '/v1/api-keys') }
export function apiCreateApiKey(name, scopes) { return apiFetch('POST', '/v1/api-keys', { name, scopes }) }
export function apiRevokeApiKey(id) { return apiFetch('DELETE', `/v1/api-keys/${encodeURIComponent(id)}`) }
export function apiListWebhooks() { return apiFetch('GET', '/v1/webhooks/endpoints') }
export function apiCreateWebhook(payload) { return apiFetch('POST', '/v1/webhooks/endpoints', payload) }
export function apiUpdateWebhook(id, payload) { return apiFetch('PUT', `/v1/webhooks/endpoints/${encodeURIComponent(id)}`, payload) }
export function apiDeleteWebhook(id) { return apiFetch('DELETE', `/v1/webhooks/endpoints/${encodeURIComponent(id)}`) }

// ── GDPR / 152-ФЗ (B5) ──────────────────────────────────────────────────────
// Экспорт данных компании (JSON): POST → job pending → воркер собирает →
// GET проверяет статус → downloadUrl (одноразовый токен, без auth).
export function apiCreateExport() { return apiFetch('POST', '/v1/account/export') }
export function apiGetExportStatus(jobId) { return apiFetch('GET', `/v1/account/export/${encodeURIComponent(jobId)}`) }
// Удаление аккаунта: требует password_confirm (защита от угнанной сессии).
// grace 30 дней — до этого можно отменить apiCancelDeleteAccount().
export function apiDeleteAccount(passwordConfirm) {
	return apiFetch('POST', '/v1/account/delete', { passwordConfirm })
}
export function apiCancelDeleteAccount() { return apiFetch('POST', '/v1/account/delete/cancel') }

export function apiCustomerPayment(customerId, body, idemKey) {
	return apiFetch('POST', `/v1/customers/${encodeURIComponent(customerId)}/payments`, body, withIdem(idemKey))
}
export function apiCommercialOrder(operation, payload, idemKey, context) {
  return apiFetch(operation === 'create' ? 'POST' : 'PUT', operation === 'create' ? '/v1/orders' : `/v1/orders/${encodeURIComponent(payload.orderId)}/commercial`, payload,
    { ...withIdem(idemKey), context })
}
export function apiMarkCodes(productId, body, idemKey) {
	return apiFetch('POST', `/v1/products/${encodeURIComponent(productId)}/mark-codes`, body, withIdem(idemKey))
}

// ── Support (AI-суппорт) ─────────────────────────────────────────────────────
// Клиент отправляет жалобу; бэкенд сохраняет тикет и (если настроен n8n) шлёт
// пайплайну, который зовёт Claude → открывает PR → шлёт нам Telegram-уведомление.
export function apiCreateSupportTicket(payload) {
	return apiFetch('POST', '/v1/support/tickets', payload)
}
export function apiListSupportTickets({ mine = true, limit = 20, offset = 0 } = {}) {
	const qs = new URLSearchParams({ mine: mine ? 'true' : 'false', limit: String(limit), offset: String(offset) })
	return apiFetch('GET', `/v1/support/tickets?${qs.toString()}`)
}
export function apiGetSupportTicket(id) {
	return apiFetch('GET', `/v1/support/tickets/${encodeURIComponent(id)}`)
}

// Password reset — эндпоинты не требуют авторизации.
// Realtime подписка на события компании через Server-Sent Events.
// Возвращает функцию отписки. Автопереподключение при разрыве.
export function subscribeEvents(onEvent) {
	if (!hasApi) return () => {}
	const context = getAuthContext()
	let stopped = false
	let controller = null
	let retryTimer = null
	let backoff = 1000

	const connect = async () => {
		if (stopped || !isAuthContextCurrent(context)) return
		let token = accessToken
		if (!token) {
			const ok = await refreshPair()
			if (!ok || !accessToken || !isAuthContextCurrent(context)) { schedule(); return }
			token = accessToken
		}
		const qs = new URLSearchParams({ access_token: token })
		controller = new AbortController()
		try {
			const res = await fetch(`${API_URL}/v1/events?${qs}`, {
				method: 'GET',
				headers: context.companyId ? { 'x-company-id': context.companyId } : {},
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
					if (!isAuthContextCurrent(context)) { await reader.cancel(); return }
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
		if (stopped || !isAuthContextCurrent(context)) return
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
	authChannel?.close(); authChannel = null; sessionEnded = false; authConsistencyError = null; seenNotices.clear()
	sessionRecord = null
	pageSuspended = false
	resumeAllowed = false
	invalidate()
	accessToken = null
	refreshToken = null
	currentUser = null
	currentCompanyId = null
	inflightRefresh = null
	authListeners.clear()
}
