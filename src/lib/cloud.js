// ──────────────────────────────────────────────────────────────────────────
//  Облачный слой веб-приложения — реализация поверх собственного бэкенда
//  skladpro-backend. Заменяет прежнюю supabase-версию.
//
//  Публичные экспорты (импортируются из store/useStore.js и страниц) сохранены
//  дословно. Часть функций, для которых в новом API пока нет прямого аналога
//  (recovery/reset пароля), возвращает понятные заглушки — не блокируем
//  запуск, но UX подсказывает связаться с админом.
// ──────────────────────────────────────────────────────────────────────────
import {
	apiApplyPasswordReset,
	apiCreateCompany,
	apiDocument,
	apiFetch,
	apiListMemberships,
	apiPinVerify,
	apiPutSettings,
	apiRequestPasswordReset,
	apiReturn,
	apiSale,
	apiSignIn,
	apiSignOut,
	apiSignUp,
	apiSyncPull,
	apiSyncPush,
	getCompanyId,
	getSession,
	hasApi,
	onAuthChange as apiOnAuthChange,
	subscribeEvents,
} from './api'
import { createOutbox } from './outbox'

const toSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

// storeKey ↔ таблица БД
const TABLES = [
	{ key: 'priceTypes', table: 'price_types', rename: { default: 'is_default' } },
	{ key: 'warehouses', table: 'warehouses' },
	{ key: 'cells', table: 'cells' },
	{ key: 'products', table: 'products' },
	{ key: 'customers', table: 'customers' },
	{ key: 'suppliers', table: 'suppliers' },
	{ key: 'employees', table: 'employees' },
	{ key: 'orders', table: 'orders' },
	{ key: 'invoices', table: 'invoices' },
	{ key: 'documents', table: 'documents' },
	{ key: 'movements', table: 'movements' },
	{ key: 'shifts', table: 'shifts' },
	{ key: 'audit', table: 'audit' },
]
const byKey = Object.fromEntries(TABLES.map((t) => [t.key, t]))
const byTable = Object.fromEntries(TABLES.map((t) => [t.table, t]))

// Локальные секреты не выгружаем в облако.
// pin — legacy plaintext (устарел), pinHash — если бэкенд когда-то протечёт
// хэш через pull (сервер сам его вырезает — see PULL_EXCLUDE_BASE — но
// подстраховываемся на клиенте).
const LOCAL_ONLY_FIELDS = { employees: new Set(['pin', 'pinHash']) }

// Поля, которые ставит сервер сам (или ведёт бизнес-эндпоинт /v1/sales / /v1/documents).
// Отсекаем их из upsert, чтобы push не получал ошибок валидации.
const SERVER_MANAGED = new Set([
	'stock', 'batches', 'cost', 'balance', 'total_spent', 'bonus',
	'pin_hash', 'row_version', 'updated_at', 'company_id', 'deleted_at',
	'stock_consumed', 'returned', 'returns',
])
const ORDER_SERVER_ONLY = new Set(['status', 'items'])

// Таблицы, которые новый sync/push не принимает вообще.
const PUSH_FORBIDDEN_TABLES = new Set(['movements', 'audit', 'documents'])

function toRow(obj, cfg) {
	const drop = LOCAL_ONLY_FIELDS[cfg.key]
	const out = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined) continue
		if (drop && drop.has(k)) continue
		const col = cfg.rename?.[k] || toSnake(k)
		if (SERVER_MANAGED.has(col)) continue
		if (cfg.key === 'orders' && ORDER_SERVER_ONLY.has(col)) continue
		out[col] = v
	}
	return out
}
function fromRow(row, cfg) {
	const rev = cfg.rename ? Object.fromEntries(Object.entries(cfg.rename).map(([a, b]) => [b, a])) : {}
	const drop = LOCAL_ONLY_FIELDS[cfg.key]
	const out = {}
	for (const [k, v] of Object.entries(row)) {
		if (v === null) continue
		const key = rev[k] || toCamel(k)
		if (drop && drop.has(key)) continue
		out[key] = v
	}
	return out
}

// Локальные-only настройки не выгружаем.
const LOCAL_ONLY_SETTINGS = ['aiKey']
const settingsForCloud = (s = {}) => {
	const out = { ...s }
	for (const k of LOCAL_ONLY_SETTINGS) delete out[k]
	return out
}

// ── Bootstrap-загрузка через инкрементальный pull ────────────────────────────
export async function cloudLoadAll() {
	if (!hasApi) return null
	const result = Object.fromEntries(TABLES.map((t) => [t.key, []]))
	let since = 0
	let total = 0
	const maxPages = 200
	for (let page = 0; page < maxPages; page++) {
		const res = await apiSyncPull({ since, limit: 1000 })
		if (!res.ok) throw new Error(res.error?.message || 'sync/pull failed')
		const tables = res.body?.tables || {}
		let anyMore = false
		let maxCursor = since
		for (const [tableName, chunk] of Object.entries(tables)) {
			const cfg = byTable[tableName]
			if (!cfg) continue
			for (const r of chunk.rows || []) {
				if (r.deleted_at) continue
				result[cfg.key].push(fromRow(r, cfg))
				total += 1
			}
			if (chunk.hasMore) anyMore = true
			if (chunk.cursor) {
				const c = Number(chunk.cursor)
				if (c > maxCursor) maxCursor = c
			}
		}
		if (!anyMore) break
		since = maxCursor
	}
	// Настройки компании — jsonb целиком
	try {
		const s = await apiFetch('GET', '/v1/settings')
		if (s.ok && s.body?.data && typeof s.body.data === 'object') result.settings = s.body.data
	} catch { /* нет настроек — ничего страшного */ }
	return total > 0 ? result : null
}

// Одиночный upsert (companyId не нужен — сервер знает по токену).
export async function cloudUpsert(storeKey, obj) {
	const cfg = byKey[storeKey]
	if (!cfg || PUSH_FORBIDDEN_TABLES.has(cfg.table)) return
	const row = { ...toRow(obj, cfg), id: obj.id }
	const res = await apiSyncPush([{ table: cfg.table, op: 'upsert', row }])
	if (!res.ok) throw new Error(res.error?.message || 'push failed')
	const r = res.body?.results?.[0]
	if (r && !r.ok) throw new Error(r.error || 'push rejected')
}

// Seed компании (первый вход). movements/audit/documents не проходят —
// это нормально, они создаются приходами через /v1/documents/post.
export async function cloudSeed(state, _companyId) {
	const ops = []
	for (const cfg of TABLES) {
		if (PUSH_FORBIDDEN_TABLES.has(cfg.table)) continue
		for (const obj of state[cfg.key] || []) {
			ops.push({ table: cfg.table, op: 'upsert', row: { ...toRow(obj, cfg), id: obj.id } })
		}
	}
	// Батчи по 250 (лимит push — 500, берём с запасом)
	for (let i = 0; i < ops.length; i += 250) {
		const chunk = ops.slice(i, i + 250)
		const res = await apiSyncPush(chunk)
		if (!res.ok) throw new Error(res.error?.message || 'seed failed')
	}
}

// Префикс id seed-записей — чтобы p_retail/wh1/A1 не конфликтовали между
// компаниями по составному PK (company_id, id).
export function remapSeedForCompany(state, companyId) {
	const p = companyId.slice(0, 8) + '_'
	const rid = (id) => (id ? p + id : id)
	const remapItems = (items) => (items || []).map((it) => ({ ...it, productId: rid(it.productId) }))
	return {
		...state,
		priceTypes: state.priceTypes.map((t) => ({ ...t, id: rid(t.id) })),
		warehouses: state.warehouses.map((w) => ({ ...w, id: rid(w.id) })),
		cells: state.cells.map((c) => ({ ...c, id: rid(c.id), warehouseId: rid(c.warehouseId) })),
		products: state.products.map((pr) => ({
			...pr,
			id: rid(pr.id),
			warehouseId: rid(pr.warehouseId),
			prices: Object.fromEntries(Object.entries(pr.prices || {}).map(([k, v]) => [rid(k), v])),
		})),
		customers: state.customers.map((c) => ({ ...c, id: rid(c.id), priceTypeId: rid(c.priceTypeId) })),
		suppliers: state.suppliers.map((s) => ({ ...s, id: rid(s.id) })),
		employees: state.employees.map((e) => ({ ...e, id: rid(e.id) })),
		orders: state.orders.map((o) => ({
			...o,
			id: rid(o.id),
			customerId: rid(o.customerId),
			priceTypeId: rid(o.priceTypeId),
			assignedTo: rid(o.assignedTo),
			items: remapItems(o.items),
		})),
		invoices: state.invoices.map((i) => ({
			...i,
			id: rid(i.id),
			partyId: rid(i.partyId),
			priceTypeId: rid(i.priceTypeId),
			items: remapItems(i.items),
		})),
		documents: (state.documents || []).map((d) => ({
			...d,
			id: rid(d.id),
			toWarehouseId: rid(d.toWarehouseId),
			items: remapItems(d.items),
		})),
		movements: state.movements.map((m) => ({ ...m, id: rid(m.id), productId: rid(m.productId) })),
		shifts: state.shifts.map((s) => ({ ...s, id: rid(s.id) })),
		audit: state.audit.map((a) => ({ ...a, id: rid(a.id) })),
	}
}

// ── Транспорт outbox: батч → apiSyncPush + при необходимости settings ────────
// «Терминальные» ответы (STALE, TABLE_FORBIDDEN, TOMBSTONE_LOCKED, …)
// считаем dropped — ретрай их не починит.
const TERMINAL_CODES = new Set(['STALE', 'TABLE_FORBIDDEN', 'BAD_ID', 'TOMBSTONE_LOCKED', 'HAS_STOCK_MOVEMENT'])

async function sendBatch(items) {
	const sent = []
	const dropped = []
	let error = null

	// Отдельно settings — они идут через /v1/settings.
	const settingsItems = items.filter((it) => it.key === 'settings')
	const syncItems = items.filter((it) => it.key !== 'settings' && !PUSH_FORBIDDEN_TABLES.has(byKey[it.key]?.table))
	const forbidden = items.filter((it) => it.key !== 'settings' && PUSH_FORBIDDEN_TABLES.has(byKey[it.key]?.table))
	dropped.push(...forbidden) // movements/audit/documents — только через бизнес-эндпоинты

	// settings: последний upsert по компании.
	if (settingsItems.length) {
		const latest = settingsItems[settingsItems.length - 1]
		try {
			const res = await apiPutSettings(latest.obj)
			if (res.ok) sent.push(...settingsItems)
			else if (res.status && res.status >= 400 && res.status < 500) dropped.push(...settingsItems)
			else error = new Error(res.error?.message || 'settings failed')
		} catch (e) { error = e }
	}

	// sync push — батчами до 250 ops.
	const CHUNK = 250
	for (let i = 0; i < syncItems.length && !error; i += CHUNK) {
		const batch = syncItems.slice(i, i + CHUNK)
		const ops = batch.map((it) => {
			const cfg = byKey[it.key]
			if (it.op === 'delete') return { table: cfg.table, op: 'delete', row: { id: it.id } }
			// updatedAt в obj — используется outbox'ом для localWins в bootstrap
			const { updatedAt, ...rest } = it.obj || {}
			const opRow = { ...toRow(rest, cfg), id: it.id }
			return {
				table: cfg.table,
				op: 'upsert',
				row: opRow,
				clientUpdatedAt: updatedAt,
			}
		})
		try {
			const res = await apiSyncPush(ops)
			if (!res.ok) { error = new Error(res.error?.message || 'push failed'); break }
			const results = res.body?.results || []
			results.forEach((r, idx) => {
				const it = batch[idx]
				if (r.ok) sent.push(it)
				else if (r.code && TERMINAL_CODES.has(r.code)) {
					console.warn('sync push dropped', it.key, it.id, r.code, r.error)
					dropped.push(it)
				} else {
					// per-op не терминальный — оставляем в очереди на следующую попытку
				}
			})
		} catch (e) { error = e; break }
	}

	return { sent, dropped, error }
}

// Единственный экземпляр очереди (экспорт — для тестов и служебных нужд)
export const syncOutbox = createOutbox({ send: sendBatch })
export const syncNow = () => syncOutbox.flushNow()

// вернулась сеть → досылаем сразу, не дожидаясь бэкоффа
if (typeof window !== 'undefined') {
	window.addEventListener('online', () => syncOutbox.flushNow())
}

let attached = false
let paused = false
let prev = null
let prevSettings = null

const snap = (state) =>
	Object.fromEntries(TABLES.map((t) => [t.key, new Map((state[t.key] || []).map((o) => [o.id, o]))]))

export function pauseSync() { paused = true }
export function resumeSync(useStore) {
	paused = false
	if (!attached) return
	const s = useStore.getState()
	prev = snap(s)
	prevSettings = s.settings
}

export function attachSync(useStore) {
	if (attached) return
	attached = true
	const st = useStore.getState()
	prev = snap(st)
	prevSettings = st.settings
	syncOutbox.onChange(({ pending, state, error }) =>
		useStore.setState({ syncPending: pending, syncState: state, syncError: error }),
	)
	useStore.subscribe((state) => {
		if (paused) return
		const companyId = state.companyId
		if (!companyId) return
		const batch = []
		for (const cfg of TABLES) {
			if (PUSH_FORBIDDEN_TABLES.has(cfg.table)) continue
			const next = new Map((state[cfg.key] || []).map((o) => [o.id, o]))
			const old = prev[cfg.key]
			for (const [id, obj] of next) {
				const before = old.get(id)
				if (!before || before !== obj) batch.push({ op: 'upsert', key: cfg.key, id, obj, companyId })
			}
			for (const id of old.keys()) {
				if (!next.has(id)) batch.push({ op: 'delete', key: cfg.key, id, companyId })
			}
		}
		if (state.settings !== prevSettings) {
			batch.push({ op: 'upsert', key: 'settings', id: companyId, obj: settingsForCloud(state.settings), companyId })
		}
		const nowIso = new Date().toISOString()
		for (const it of batch) {
			if (it.op === 'upsert' && it.key !== 'settings') it.obj = { ...it.obj, updatedAt: nowIso }
		}
		if (!batch.length) return
		if (syncOutbox.enqueue(batch)) {
			prev = snap(state)
			prevSettings = state.settings
		}
	})
}

// ── Загрузка с учётом неотправленного ──────────────────────────────────────
export async function cloudLoadMerged() {
	await syncOutbox.flushNow().catch(() => {})
	const data = await cloudLoadAll()
	const pending = syncOutbox.items()
	if (data && pending.length) applyPendingToData(data, pending)
	return data
}

const parseTs = (v) => {
	const t = Date.parse(v || '')
	return Number.isNaN(t) ? -Infinity : t
}
const localWins = (pendingObj, serverObj) => {
	const p = pendingObj?.updatedAt
	const s = serverObj?.updatedAt
	if (!p || !s) return true
	return parseTs(p) >= parseTs(s)
}

export function applyPendingToData(data, pending) {
	for (const it of pending) {
		if (it.key === 'settings') {
			if (it.op === 'upsert') data.settings = { ...(data.settings || {}), ...it.obj }
			continue
		}
		const arr = data[it.key]
		if (!Array.isArray(arr)) continue
		const i = arr.findIndex((r) => r.id === it.id)
		if (it.op === 'delete') {
			if (i >= 0) arr.splice(i, 1)
		} else if (i >= 0) {
			if (localWins(it.obj, arr[i])) arr[i] = it.obj
		} else arr.push(it.obj)
	}
	return data
}

// ── Компании (тенанты) ───────────────────────────────────────────────────────
// Возвращает объект в старом формате { company_id, role, name, companies:{name} } | null.
export async function getMembership() {
	const r = await apiListMemberships()
	if (!r.ok) return null
	const m = (r.body?.memberships || [])[0]
	if (!m) return null
	return { company_id: m.companyId, role: m.role, name: m.name, companies: { name: m.companyName, plan: null } }
}

export async function createCompanyCloud(companyName, userName) {
	const r = await apiCreateCompany(companyName, userName)
	if (!r.ok) return { ok: false, error: r.error?.message || 'Не удалось создать компанию' }
	return { ok: true, companyId: r.body?.company?.id }
}

export async function acceptInvitation() {
	const r = await apiFetch('POST', '/v1/invitations/accept', {}, { skipCompany: true })
	if (!r.ok) return null
	return r.body?.companyId ?? null
}

// ── Команда: участники и приглашения ─────────────────────────────────────────
// Возвращают в формате старого supabase-response, чтобы UI не менять.
export async function loadMembers() {
	const r = await apiFetch('GET', '/v1/companies/members')
	if (!r.ok) return []
	return (r.body?.members || []).map((m) => ({
		user_id: m.userId, email: m.email, role: m.role, name: m.name,
		active: m.active, created_at: m.createdAt,
	}))
}
export async function loadInvites() {
	const r = await apiFetch('GET', '/v1/invitations')
	if (!r.ok) return []
	return (r.body?.invitations || []).map((i) => ({
		id: i.id, email: i.email, role: i.role, name: i.name, created_at: i.createdAt,
	}))
}
export async function inviteMember(_companyId, email, role, name) {
	const r = await apiFetch('POST', '/v1/invitations', { email, role, name })
	if (!r.ok) return { ok: false, error: r.error?.message }
	return { ok: true }
}
export async function revokeInvite(id) {
	const r = await apiFetch('DELETE', `/v1/invitations/${encodeURIComponent(id)}`)
	if (!r.ok) return { ok: false, error: r.error?.message }
	return { ok: true }
}
export async function updateMemberRole(userId, _companyId, role) {
	const r = await apiFetch('PATCH', `/v1/memberships/${encodeURIComponent(userId)}`, { role })
	if (!r.ok) return { ok: false, error: r.error?.message }
	return { ok: true }
}
export async function removeMember(userId, _companyId) {
	const r = await apiFetch('DELETE', `/v1/memberships/${encodeURIComponent(userId)}`)
	if (!r.ok) return { ok: false, error: r.error?.message }
	return { ok: true }
}

// ── Пароль ───────────────────────────────────────────────────────────────────
// Смена пароля залогиненным пользователем требует старый пароль.
// UI, который знает только новый пароль, попросим спросить oldPassword у пользователя.
export async function changePassword(newPassword, oldPassword) {
	if (!oldPassword) return { ok: false, error: 'Введите текущий пароль' }
	const r = await apiFetch('POST', '/v1/auth/password/change', { oldPassword, newPassword })
	if (!r.ok) return { ok: false, error: r.error?.message || 'Не удалось сменить пароль' }
	return { ok: true }
}
// Запрос сброса пароля: сервер всегда отвечает 200, но реально письмо уходит
// только если email найден и SMTP настроен на бэкенде.
export async function requestPasswordReset(email) {
	return apiRequestPasswordReset(email)
}
// Применение magic-link из письма (расшитый токен из URL): применяет новый пароль.
export async function applyPasswordReset(token, newPassword) {
	return apiApplyPasswordReset(token, newPassword)
}
// В новом бэкенде токен reset живёт в query URL (?token=...), не в hash-фрагменте.
// Возвращаем строку токена, если он есть — вызывающий пусть спросит новый пароль.
export function checkRecovery() {
	try {
		if (typeof window === 'undefined') return null
		const hash = window.location.hash.replace(/^#\/?/, '')
		const params = new URLSearchParams(hash.split('?')[1] || hash)
		const token = params.get('token')
		return token || null
	} catch { return null }
}

// ── PIN на сервере (bcrypt) ──────────────────────────────────────────────────
export async function verifyPinCloud(employeeId, pin) {
	const r = await apiPinVerify(employeeId, pin)
	if (!r.ok) return { ok: false, error: r.error?.message || 'Неверный PIN' }
	const emp = r.body?.employee
	return emp ? { ok: true, id: emp.id, role: emp.role, name: emp.name } : { ok: false, error: 'Неверный PIN' }
}

// ── Бизнес-обёртки: продажи/документы/статусы/возвраты ───────────────────────
// Idempotency-Key детерминированный (по id операции + хеш параметров).
export async function sellCloud(order) {
	const r = await apiSale(order, `sale-${order.id}`)
	if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code, details: r.error?.details }
	return { ok: true, order: r.body?.order }
}
export async function postDocumentCloud(document) {
	const r = await apiDocument(document, `doc-${document.id}`)
	if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code }
	return { ok: true, document: r.body?.document }
}
export async function returnCloud({ orderId, items, reason }) {
	const items_key = items ? items.map((i) => `${i.productId}:${i.qty}`).join(',') : 'full'
	const r = await apiReturn({ orderId, items, reason }, `ret-${orderId}-${simpleHash(items_key)}`)
	if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code }
	return { ok: true, orderId: r.body?.orderId, fullyReturned: r.body?.fullyReturned }
}
export async function orderStatusCloud(orderId, status) {
	const r = await apiFetch('POST', `/v1/orders/${encodeURIComponent(orderId)}/status`, { status },
		{ headers: { 'idempotency-key': `ost-${orderId}-${status}` } })
	if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code }
	return { ok: true }
}
function simpleHash(s) {
	let h = 0
	for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
	return (h >>> 0).toString(36)
}

// ── Авторизация ──────────────────────────────────────────────────────────────
export async function getCloudSession() { return getSession() }
export function onAuthChange(cb) {
	return apiOnAuthChange((event, session) => cb(event, session))
}
export async function cloudSignIn(email, password) { return apiSignIn(email, password) }
export async function cloudSignUp(email, password, name) {
	const r = await apiSignUp(email, password, name)
	if (!r.ok) return r
	// Совместимость: старая версия могла вернуть needConfirm — теперь сессия сразу.
	return { ok: true, user: r.user, name }
}
export async function cloudSignOut() { await apiSignOut() }

// Realtime подписка на события компании — используется в UI, чтобы после
// продажи/платежа на другом устройстве немедленно обновить локальный кэш.
export function subscribeToEvents(onEvent) {
	return subscribeEvents(onEvent)
}

export { hasApi as hasCloud, getCompanyId }
