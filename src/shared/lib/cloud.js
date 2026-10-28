import { sanitizeSensitiveText } from './sensitiveTelemetry'
import { getInvitationProof, isInvitationProofCurrent, clearInvitationSecret, requireInvitationTransport } from './invitationSecret'
import { verifyCancellationResponse } from './cancellationV2'
import { verifyDeliveryResponse } from './deliveryV2'
import { isShipmentV2, verifyShipmentResponse } from './shipmentV2'
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
	apiCommercialOrder,
	apiCreateCompany,
	apiDocument,
	apiFetch,
	apiListMemberships,
	apiOrderStatus,
	apiPinVerify,
	apiPutSettings,
	apiRequestPasswordReset,
	apiReturn,
	apiSale,
	apiSignIn,
	apiSignOut,
	apiSignUp,
	apiSyncPull,
	apiStockReconcile,
	apiSyncPush,
	getCompanyId,
	getAuthContext,
	isAuthContextCurrent,
	getSession,
	hasApi,
	onAuthChange as apiOnAuthChange,
	subscribeEvents,
} from '@/shared/api'
import { createOutbox } from './outbox'
import { companyCache } from './scopedCache'
import { mergeProduct, warehouseCommandRequest } from './stockProjection'
import { commandResources } from './outboxDependencies'
import { createWarehouseReconciler } from './warehouseSnapshot'
import { isSaleV2, saleOrder, saleKey, verifySaleResponse } from './saleV2'
import { COMMERCIAL_KEYS, isCommercialOrder, verifyCommercialResponse } from './commercialOrders'
import { pushEvent } from './diagRing'

const toSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
// Explicit scoped reads only: no automatic flush, projection, or acknowledgement of outbox.
export const cloudReconcileStock = createWarehouseReconciler({
	fetchSnapshot: (request, context) => apiStockReconcile(request, context),
	cache: companyCache, getContext: getAuthContext, isCurrent: isAuthContextCurrent,
})
export async function refreshWarehouseStock(productIds, context = getAuthContext()) {
	const products = new Set(productIds)
	const commands = companyCache.warehouseCommands(context).filter((op) => {
		const resource = commandResources(op)
		return resource.stock && (!resource.products.length || resource.products.some((p) => products.has(p)))
	})
	for (const op of commands) for (const p of commandResources(op).products) products.add(p)
	return cloudReconcileStock({ productIds: [...products], commands: commands.map(warehouseCommandRequest) }, context)
}
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
	// Маркер серверного пути: ставят /v1/sales и /v1/orders/:id/status.
	// Клиент его только читает (pull) — эхо через push запрещено, иначе
	// LWW-гонка двух вкладок могла бы стереть маркер.
	'shipment_doc_id',
	'confirmed_stock', 'pending_stock_delta',
	'warehouse_projection',
	'commercial_snapshot', 'commercial_contract_version', 'commercial_row_version', 'commercial_pending', 'server_units', 'delivery_pending', 'cancellation_pending', 'shipment_pending', 'shipment_queued', 'shipment_warehouse_id',
])
const ORDER_SERVER_ONLY = new Set(['status', 'items'])

// Таблицы, которые новый sync/push не принимает вообще.
const PUSH_FORBIDDEN_TABLES = new Set(['movements', 'audit', 'documents'])

// Ключи бизнес-операций в outbox — идут не в sync/push, а в свои
// эндпоинты (/v1/sales, /v1/orders/:id/status, /v1/documents/post).
// Каждый item несёт полный payload и обрабатывается транзакционно
// на сервере (post_doc/unpost_doc). Ретрай через outbox переживает
// перезагрузку вкладки, оффлайн и падение сети.
const BUSINESS_KEYS = new Set(['sale', 'order_status', 'doc_post', 'return_v2', 'order_delivery', 'order_cancel', ...COMMERCIAL_KEYS])

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
export async function cloudLoadAll(context = getAuthContext()) {
	if (!hasApi) return null
	const result = Object.fromEntries(TABLES.map((t) => [t.key, []]))
	const saleLines = new Map()
	const units = new Map()
	const ingest = (tableName, chunk) => {
		if (tableName === 'product_units') for (const unit of chunk.rows || []) {
			if (!unit.deleted_at) {
				if (!units.has(unit.product_id)) units.set(unit.product_id, [])
				units.get(unit.product_id).push({ id: unit.id, name: unit.name, factor: String(unit.factor), isBase: !!unit.is_base })
			}
		}
		if (tableName === 'doc_lines') for (const line of chunk.rows || []) {
			if (!line.deleted_at) saleLines.set(`${line.doc_id}:${line.line_no}`, line)
		}
		const cfg = byTable[tableName]
		if (cfg) for (const r of chunk.rows || []) if (!r.deleted_at) result[cfg.key].push(fromRow(r, cfg))
	}
	const pull = async (params) => {
		if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
		const res = await apiSyncPull({ ...params, limit: 1000, context })
		if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
		if (!res.ok) throw Object.assign(new Error(res.error?.message || 'sync/pull failed'), { status: res.status })
		return res.body?.tables || {}
	}
	const tables = await pull({ since: '0' })
	for (const [table, first] of Object.entries(tables)) {
		let chunk = first, since = '0'
		for (let page = 0; ; page++) {
			ingest(table, chunk)
			if (!chunk.hasMore) break
			if (page >= 199 || !chunk.cursor || BigInt(chunk.cursor) <= BigInt(since)) throw new Error(`Неполная загрузка ${table}`)
			since = String(chunk.cursor)
			chunk = (await pull({ table, since }))[table]
			if (!chunk || !Array.isArray(chunk.rows)) throw new Error(`Неполная загрузка ${table}`)
		}
	}
	// Настройки компании — jsonb целиком
	result.products = result.products.map((p) => ({ ...p, serverUnits: units.get(p.id) || [] }))
	for (const row of result.orders) if (row.commercialSnapshot) companyCache.saveCommercialOrder(context, row)
	result.orders = result.orders.map((order) => ({ ...order, items: (order.items || []).map((item, index) => {
		const line = saleLines.get(`${order.shipmentDocId}:${index}`)
		return line?.product_id === item.productId ? { ...item, saleLineId: line.id, qtyBase: String(line.qty) } : item
	}) }))
	try {
		const s = await apiFetch('GET', '/v1/settings', undefined, { context })
		if (s.ok && s.body?.data && typeof s.body.data === 'object') result.settings = s.body.data
	} catch { /* нет настроек — ничего страшного */ }
	if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
	return result
}

// Одиночный upsert (companyId не нужен — сервер знает по токену).
export async function cloudUpsert(storeKey, obj, context = getAuthContext()) {
	if (storeKey === 'orders' && (isCommercialOrder(obj) || companyCache.commercialOrder?.(context, obj.id) || syncOutbox.items().some((op) => COMMERCIAL_KEYS.includes(op.key) && op.obj.orderId === obj.id))) throw new Error('Защищённый заказ нельзя отправлять через legacy sync')
	const cfg = byKey[storeKey]
	if (!cfg || PUSH_FORBIDDEN_TABLES.has(cfg.table)) return
	const row = { ...toRow(obj, cfg), id: obj.id }
	const res = await apiSyncPush([{ table: cfg.table, op: 'upsert', row }], context)
	if (!res.ok) throw new Error(res.error?.message || 'push failed')
	const r = res.body?.results?.[0]
	if (r && !r.ok) throw new Error(r.error || 'push rejected')
}

// Seed компании (первый вход). movements/audit/documents не проходят —
// это нормально, они создаются приходами через /v1/documents/post.
export async function cloudSeed(state, companyId) {
	const context = getAuthContext()
	if (!companyId || context.companyId !== companyId || state.authAccountId !== context.userId) throw new Error('CONTEXT_CHANGED')
	const ops = []
	for (const cfg of TABLES) {
		if (PUSH_FORBIDDEN_TABLES.has(cfg.table)) continue
		for (const obj of state[cfg.key] || []) {
			if (cfg.key === 'orders' && isCommercialOrder(obj)) continue
			ops.push({ table: cfg.table, op: 'upsert', row: { ...toRow(obj, cfg), id: obj.id } })
		}
	}
	// Батчи по 250 (лимит push — 500, берём с запасом)
	for (let i = 0; i < ops.length; i += 250) {
		const chunk = ops.slice(i, i + 250)
		if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
		const res = await apiSyncPush(chunk, context)
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
// SUBSCRIPTION_LIMIT_EXCEEDED — тоже терминал: клиенту надо апгрейд плана,
// повторные попытки того же upsert только съедят батареи. UI ловит через
// syncError и показывает UpgradeModal.
const TERMINAL_CODES = new Set(['STALE', 'TABLE_FORBIDDEN', 'BAD_ID', 'TOMBSTONE_LOCKED', 'HAS_STOCK_MOVEMENT', 'SUBSCRIPTION_LIMIT_EXCEEDED'])

// Бизнес-операция из outbox → соответствующий эндпоинт.
// Возвращает { ok } | { ok:false, quarantine, code, error, status, traceId }.
// quarantine=true → операция не пройдёт повтором (валидация, дубль, конфликт),
// НО терять её нельзя: чек напечатан, деньги взяты. Такой item помечается
// _quarantined в очереди — остаётся видимым в панели диагностики с полным
// payload+traceId, пока человек не решит вручную (пересоздать/отменить).
// quarantine=false → транзиент (сеть/5xx), ретрай через exponential backoff.
async function sendBusinessOp(it, context) {
	try {
		const payload = it.obj || {}
		let res
		if (it.key === 'sale') {
			res = await apiSale(payload, saleKey(it), context)
		} else if (COMMERCIAL_KEYS.includes(it.key)) {
			res = await apiCommercialOrder(it.key === 'commercial_create' ? 'create' : 'replace', payload, it.idempotencyKey, context)
			if (res.ok) {
				if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
				if (!await verifyCommercialResponse(it.key, payload, res.body, context.companyId)) return { ok: false, quarantine: true, code: 'COMMERCIAL_RESPONSE_UNVERIFIED', error: 'Ответ заказа требует сверки' }
				// Replay can return an older receipt. Pull the current row, never restore its old composition.
				let cursor = (BigInt(res.body.order.rowVersion) - 1n).toString(), found = null
				for (let page = 0; page < 200; page++) {
					const read = await apiSyncPull({ table: 'orders', since: cursor, limit: 1000, context })
					if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
					if (!read.ok) throw new Error('Команда проведена; текущая версия заказа ещё не получена')
					const chunk = read.body?.tables?.orders
					found = chunk?.rows?.find((row) => row.id === payload.orderId)
					if (found || !chunk?.hasMore) break
					if (!chunk.cursor || BigInt(chunk.cursor) <= BigInt(cursor)) throw new Error('Некорректный курсор заказов')
					cursor = String(chunk.cursor)
				}
				if (!found || found.deleted_at || BigInt(found.row_version) < BigInt(res.body.order.rowVersion)) throw new Error('Текущая версия заказа не подтверждена')
				companyCache.saveCommercialOrder(context, fromRow(found, byKey.orders))
			}
		} else if (it.key === 'doc_post') {
			res = await apiDocument(payload, `doc-${it.id}`, context)
		} else if (it.key === 'order_status') {
			if (isShipmentV2(payload)) {
                res = await apiOrderStatus(it.id, payload, it.idempotencyKey, context)
                if (res.ok) {
                    if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
                    if (!await verifyShipmentResponse(it.id, payload, res.body, context.companyId)) return { ok: false, quarantine: true, code: 'SHIPMENT_RESPONSE_UNVERIFIED', error: 'Ответ отгрузки требует сверки' }
                    await refreshProtectedOrder(it.id, context)
                }
            } else res = await apiOrderStatus(payload.orderId, payload.status, `ost-${payload.orderId}-${payload.status}`, context)
		} else if (it.key === 'order_delivery' || it.key === 'order_cancel') {
            res = await apiOrderStatus(payload.orderId, payload.request, it.idempotencyKey, context)
            if (res.ok) {
                if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
                if (!await (it.key === 'order_cancel' ? verifyCancellationResponse : verifyDeliveryResponse)(payload, res.body, context.companyId, it.idempotencyKey)) return { ok: false, quarantine: true, code: it.key === 'order_cancel' ? 'CANCELLATION_RESPONSE_UNVERIFIED' : 'DELIVERY_RESPONSE_UNVERIFIED', error: 'Ответ изменения заказа требует сверки; команда сохранена' }
                await refreshProtectedOrder(payload.orderId, context, res.body.order.rowVersion)
            } else if (res.status === 409 || res.status === 422) {
                try { await refreshProtectedOrder(payload.orderId, context) }
                catch (e) { if (!isAuthContextCurrent(context)) throw e }
            }
        } else if (it.key === 'return_v2') {
			res = await apiReturn(payload.request, `return:${it.id}`, context)
		} else {
			return { ok: false, quarantine: true, code: 'UNKNOWN_KEY', error: `unknown business key ${it.key}` }
		}
		if (it.key === 'sale' && isSaleV2(payload) && res.ok && !await verifySaleResponse(payload, res.body, context.companyId)) {
			return { ok: false, quarantine: true, code: 'SALE_RESPONSE_UNVERIFIED', error: 'Ответ продажи не подтверждён; требуется сверка' }
		}
		if (it.key === 'return_v2' && res.ok) {
			const body = res.body
			if (body?.contractVersion !== 2 || body.returnId !== it.id || body.orderId !== payload.request.orderId ||
				body.documentId !== `ret-${it.id}` || !body.fingerprint || !Array.isArray(body.items) ||
				body.items.length !== payload.request.items.length || payload.request.items.some((line) =>
					!body.items.some((result) => result.saleLineId === line.saleLineId && Number(result.qtyBase) === Number(line.qtyBase)))) {
				return { ok: false, quarantine: true, code: 'RETURN_RESPONSE_UNVERIFIED', error: 'Ответ возврата не подтверждён; требуется сверка' }
			}
		}
		if (res.ok) return { ok: true }
		// idempotency-replayed → уже применено на сервере, считаем успехом
		const replayed = res.headers?.['idempotency-replayed'] === 'true'
		if (replayed && it.key !== 'order_delivery' && it.key !== 'order_cancel' && !isShipmentV2(payload) && !COMMERCIAL_KEYS.includes(it.key) && it.key !== 'return_v2' && !(it.key === 'sale' && isSaleV2(payload))) return { ok: true }
		const status = res.status ?? 0
		const code = res.error?.code
		// 4xx (кроме 408/429) — не починится повтором: карантин.
		const isQuarantine = status >= 400 && status < 500 && status !== 408 && status !== 429
		return {
			ok: false,
			quarantine: isQuarantine,
			code,
			status,
			traceId: res.traceId,
			error: (res.error?.message || `${it.key} failed (${status})`) + ((COMMERCIAL_KEYS.includes(it.key) || it.key === 'order_delivery' || it.key === 'order_cancel' || isShipmentV2(payload)) && res.error?.details ? `: ${JSON.stringify(res.error.details)}` : ''),
		}
	} catch (e) {
		return { ok: false, quarantine: false, code: 'NETWORK', error: e?.message || 'network' }
	}
}

async function sendBatch(items, queueContext) {
	const context = getAuthContext()
	const current = () => isAuthContextCurrent(context) && queueContext.isCurrent()
	if (!current() || items.some((it) => it.userId !== context.userId || it.companyId !== context.companyId)) {
		return { error: new Error('CONTEXT_CHANGED') }
	}
	const sent = []
	const dropped = []
	const protectedIds = new Set(items.filter((op) => COMMERCIAL_KEYS.includes(op.key)).map((op) => op.obj.orderId))
	for (const op of syncOutbox.items()) if (COMMERCIAL_KEYS.includes(op.key)) protectedIds.add(op.obj.orderId)
	const protectedLegacy = items.filter((it) => it.key === 'orders' && (isCommercialOrder(it.obj) || protectedIds.has(it.id) || companyCache.commercialOrder?.(context, it.id)))
	let error = null

	// Отдельно settings — они идут через /v1/settings.
	const settingsItems = items.filter((it) => it.key === 'settings')
	// Бизнес-операции (продажа/статус/документ) — свои эндпоинты.
	const businessItems = items.filter((it) => BUSINESS_KEYS.has(it.key))
	const syncItems = items.filter(
		(it) => it.key !== 'settings'
			&& !protectedLegacy.includes(it)
			&& !BUSINESS_KEYS.has(it.key)
			&& !PUSH_FORBIDDEN_TABLES.has(byKey[it.key]?.table),
	)
	const forbidden = items.filter(
		(it) => it.key !== 'settings'
			&& !BUSINESS_KEYS.has(it.key)
			&& PUSH_FORBIDDEN_TABLES.has(byKey[it.key]?.table),
	)
	dropped.push(...forbidden) // movements/audit/documents — только через бизнес-эндпоинты

	// Бизнес-операции: последовательно, каждая — со своим idempotency-key.
	// Порядок важен: sale перед order_status(cancelled) по тому же orderId,
	// иначе отмена придёт до того, как заказ вообще появится на сервере.
	// Компакция outbox по (key,id) сохраняет один item на операцию.
	// Карантин: 4xx НЕ удаляет item. Помечаем _quarantined через syncOutbox
	// после цикла (mutate внутри — простая ссылка, persist сделает сам).
	// Ретрай карантинного — только вручную (retryQuarantined).
	const toQuarantine = protectedLegacy.map((it) => ({ it, reason: { code: 'ORDER_COMMERCIAL_PROTECTED', error: 'Legacy-команда сохранена для разбора: коммерческий заказ защищён' } }))
	let businessError = null
	for (const it of businessItems) {
		if (!current()) { error ||= new Error('CONTEXT_CHANGED'); break }
		if (!queueContext.canSendBusiness?.(it)) continue
		const r = await sendBusinessOp(it, context)
		if (r.ok) sent.push(it)
		else if (r.quarantine) {
			// Не в dropped — иначе outbox сотрёт элемент, чек испарится.
			// Не в sent — сервер операцию не принял.
			// Помечаем карантинным ниже: элемент остаётся в очереди для
			// разбора, автоматических ретраев не будет.
			pushEvent(`${it.key}_quarantined`, {
				id: it.id, code: r.code, status: r.status, error: r.error, traceId: r.traceId,
			})
			toQuarantine.push({ it, reason: { code: r.code, status: r.status, error: r.error, traceId: r.traceId } })
		} else {
			businessError ||= new Error(r.error || `${it.key} failed`)
		}
	}
	// Outbox writes quarantine metadata cooperatively after this bounded request.

	// settings: последний upsert по компании.
	if (settingsItems.length && !error && current()) {
		const latest = settingsItems[settingsItems.length - 1]
		try {
			const res = await apiPutSettings(latest.obj, context)
			if (res.ok) sent.push(...settingsItems)
			else if (res.status && res.status >= 400 && res.status < 500) dropped.push(...settingsItems)
			else error = new Error(res.error?.message || 'settings failed')
		} catch (e) { error = e }
	}

	// sync push — батчами до 250 ops.
	const CHUNK = 250
	for (let i = 0; i < syncItems.length && !error && current(); i += CHUNK) {
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
			const res = await apiSyncPush(ops, context)
			if (!res.ok) {
				pushEvent('sync_push_error', { status: res.status, code: res.error?.code, error: res.error?.message, traceId: res.traceId })
				error = new Error(res.error?.message || 'push failed'); break
			}
			const results = res.body?.results || []
			results.forEach((r, idx) => {
				const it = batch[idx]
				if (r.ok) sent.push(it)
				else if (r.code && TERMINAL_CODES.has(r.code)) {
					pushEvent('sync_op_quarantine', { table: it.key, id: it.id, code: r.code, error: r.error })
					toQuarantine.push({ it, reason: { code: r.code, error: r.error } })
					// Keep payload for review; a rejection is not a confirmation.
				} else {
					pushEvent('sync_op_fail', { table: it.key, id: it.id, code: r.code, error: r.error })
				}
			})
		} catch (e) {
			pushEvent('sync_push_error', { error: e?.message || 'network' })
			error = e; break
		}
	}

	if (!current()) error ||= new Error('CONTEXT_CHANGED')
	return { sent, dropped, quarantined: toQuarantine, error: error || businessError }
}

// Единственный экземпляр очереди (экспорт — для тестов и служебных нужд)
export const syncOutbox = createOutbox({ send: sendBatch })
export const syncNow = () => syncOutbox.flushNow()
export function activateCloudContext(context, suspended = false) {
	paused = true
	prev = null; prevSettings = null
	syncOutbox.setContext(context, { suspended })
}
export function stopCloudSync() {
	paused = true
	syncOutbox.setContext(null)
	prev = null; prevSettings = null
}
async function enqueueBusiness(item) {
	if (!hasApi) return { ok: true } // demo operations stay in the demo store
	const context = getAuthContext()
	if (!context.userId || !context.companyId || !isAuthContextCurrent(context)) return { ok: false, code: 'CONTEXT_CHANGED', error: 'Пользователь и компания не подтверждены' }
	return syncOutbox.enqueueCommand({ ...item, userId: context.userId, companyId: context.companyId })
}

// вернулась сеть → досылаем сразу, не дожидаясь бэкоффа
if (typeof window !== 'undefined') {
	window.addEventListener('online', () => syncOutbox.flushNow())
}

// ── Бизнес-операции в outbox: переживают перезагрузку, оффлайн и сбой сети ─
// После подтверждённой записи payload неизменяем. Повтор с тем же (key,id)
// и другим payload — конфликт. Подтверждения сохраняются для защиты повторов;
// при 4xx команда остаётся в карантине, при сети/5xx повторяется.
export function enqueueSale(order, sourceDocumentId) {
	const id = saleOrder(order).id
	return enqueueBusiness({ op: 'create', key: 'sale', id, ...(isSaleV2(order) ? { idempotencyKey: `sale-${id}`,
		...(sourceDocumentId ? { sourceDocumentId } : {}) } : {}), obj: order })
}
export function enqueueReturn(command) {
	return enqueueBusiness({ op: 'create', key: 'return_v2', id: command.request.returnId, obj: command })
}
export function enqueueCommercialOrder(key, payload) {
	return enqueueBusiness({ op: key === 'commercial_create' ? 'create' : 'update', key, id: payload.commandId,
		idempotencyKey: `commercial:${payload.commandId}`, obj: payload })
}
export function enqueueDocument(document) {
	return enqueueBusiness({ op: 'create', key: 'doc_post', id: document.id, obj: document })
}
// Один item на (orderId,status): если пользователь дважды жмёт «Отменить» —
// идемпотентность по key на клиенте и Idempotency-Key на сервере отсекают.
export function enqueueCancellation(envelope) {
    const id = `cancelled:${envelope.request.shipmentId}`
    return enqueueBusiness({ op: 'update', key: 'order_cancel', id, idempotencyKey: id, obj: envelope })
}
export function enqueueDelivery(envelope) {
    const id = `delivered:${envelope.request.shipmentId}`
    return enqueueBusiness({ op: 'update', key: 'order_delivery', id, idempotencyKey: id, obj: envelope })
}
export function enqueueShipment(orderId, body) {
    return enqueueBusiness({ op: 'update', key: 'order_status', id: orderId, idempotencyKey: `shipment:${body.shipmentId}`, obj: body })
}
export async function refreshProtectedOrder(orderId, context = getAuthContext(), minimumVersion) {
    let since = '0'
    for (let page = 0; page < 200; page++) {
        const res = await apiSyncPull({ table: 'orders', since, limit: 1000, context })
        if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
        if (!res.ok) throw new Error('Текущий заказ не получен; команда сохранена')
        const chunk = res.body?.tables?.orders, row = chunk?.rows?.find(r => r.id === orderId)
        if (row && !row.deleted_at) { if (minimumVersion && BigInt(row.row_version) < BigInt(minimumVersion)) throw new Error('Текущая версия заказа ещё не получена; команда сохранена'); companyCache.saveCommercialOrder(context, fromRow(row, byKey.orders)); return }
        if (!chunk?.hasMore || !chunk.cursor || BigInt(chunk.cursor) <= BigInt(since)) break
        since = String(chunk.cursor)
    }
    throw new Error('Текущая версия заказа не подтверждена')
}
export async function prepareProtectedShipment(orderId) {
    const context = getAuthContext()
    const res = await apiOrderStatus(orderId, 'picking', `prepare-shipment:${orderId}`, context)
    if (!res.ok) throw new Error(res.error?.message || 'Подготовка не подтверждена; обновите заказ')
    await refreshProtectedOrder(orderId, context)
}
export function enqueueOrderStatus(orderId, status) {
	return enqueueBusiness({ op: 'update', key: 'order_status', id: `${orderId}:${status}`, obj: { orderId, status } })
}

let attached = false
let paused = false
let prev = null
let prevSettings = null
let enqueueing = false
let commercialStorageListener = null

const snap = (state) =>
	Object.fromEntries(TABLES.map((t) => [t.key, new Map((state[t.key] || []).map((o) => [o.id, o]))]))

// Что из таблицы cfg.key имеет право уехать через sync/push.
// Заказы с документом отгрузки (shipmentDocId) — исключены: они ушли
// серверным путём (/v1/sales), sync/push стал бы вторым писателем.
// kind='retail' без маркера — legacy-чеки до появления shipmentDocId:
// их тоже не трогаем (они на сервере от /v1/sales или старого push).
// Функция чистая: одинаково применяется к prev и next в attachSync — иначе
// асимметрия сотрёт данные с сервера через detect-delete.
function pushableForKey(key) {
	if (key === 'orders') return (o) => !isCommercialOrder(o) && !o?.shipmentDocId && o?.kind !== 'retail' && o?.refundContractVersion !== 2
	return () => true
}
function filterMap(m, pred) {
	const out = new Map()
	for (const [k, v] of m) if (pred(v)) out.set(k, v)
	return out
}

// Только для vitest: между тестами модульный singleton attached удерживает
// первую подписку и игнорирует повторный attachSync. В продакшене вызывается
// один раз за жизнь вкладки.
export function __resetSyncForTests() {
	if (commercialStorageListener && typeof window !== 'undefined') window.removeEventListener('storage', commercialStorageListener)
	commercialStorageListener = null
	attached = false
	paused = false
	prev = null
	prevSettings = null
}
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
	commercialStorageListener = (event) => {
		const context = getAuthContext(), current = useStore.getState()
		if (!(event.key?.startsWith(`sklad.db.v3.${encodeURIComponent(context.userId)}:${encodeURIComponent(context.companyId)}.commercial.`) || event.key?.startsWith(`sklad.outbox.v2.${encodeURIComponent(context.userId)}:${encodeURIComponent(context.companyId)}.`)) ||
			!current.cloudReady || current.companyId !== context.companyId || current.authAccountId !== context.userId) return
		try {
			const projected = companyCache.overlayLocal(context, current)
			pauseSync(); useStore.setState({ orders: projected.orders }); resumeSync(useStore)
		} catch (e) { useStore.setState({ cloudError: e.message }) }
	}
	if (typeof window !== 'undefined') window.addEventListener('storage', commercialStorageListener)
	let returnEntries = new Set(), returnScope = null, returnRefresh = null
	syncOutbox.onChange(({ pending, quarantined, blockedLegacy, state, error }) => {
		useStore.setState({
			syncPending: pending,
			syncQuarantined: quarantined || 0,
			syncLegacy: blockedLegacy || 0,
			syncState: state,
			syncError: error,
		})
		const context = getAuthContext(), currentState = useStore.getState()
		const scope = `${context.userId}:${context.companyId}`
		const entries = new Set(syncOutbox.items().filter(op => op.key === 'return_v2' || op.key === 'order_cancel').map((op) => op._entryId))
		const confirmed = returnScope === scope && [...returnEntries].some((id) => !entries.has(id))
		const changed = entries.size || (returnScope === scope && returnEntries.size) || currentState.orders.some(isCommercialOrder) || syncOutbox.items().some((op) => COMMERCIAL_KEYS.includes(op.key))
		returnEntries = entries; returnScope = scope
		if (!currentState.cloudReady || currentState.companyId !== context.companyId || currentState.authAccountId !== context.userId) return
		if (changed) {
			try {
				const projected = companyCache.overlayLocal(context, currentState)
				pauseSync(); useStore.setState({ products: projected.products, orders: projected.orders }); resumeSync(useStore)
			} catch (e) { useStore.setState({ cloudError: e.message }) }
		}
		if (confirmed && !returnRefresh) {
			returnRefresh = Promise.resolve().then(async () => {
				try {
					const fresh = await cloudLoadMerged(context)
					if (!isAuthContextCurrent(context) || !fresh) return
					pauseSync(); useStore.setState(fresh); resumeSync(useStore)
				} catch (e) { if (isAuthContextCurrent(context)) useStore.setState({ cloudError: e.message }) }
			}).finally(() => { returnRefresh = null })
		}
	})
	useStore.subscribe((state) => {
		if (paused || enqueueing) return
		const companyId = state.companyId
		const context = getAuthContext()
		if (!state.cloudReady || !companyId || companyId !== context.companyId || state.authAccountId !== context.userId) return
		if (!prev) { prev = snap(state); prevSettings = state.settings; return }
		const batch = []
		for (const cfg of TABLES) {
			if (PUSH_FORBIDDEN_TABLES.has(cfg.table)) continue
			// Retail-чеки идут через /v1/sales, а не через sync/push. Фильтр
			// применяется СИММЕТРИЧНО к next и old — иначе delete-цикл увидит
			// «был в prev, нет в next» и отправит delete на сервер, стирая
			// заказ, который туда положил /v1/sales. Сохранение фильтра в
			// одном месте — единый предикат isPushable.
			const isPushable = pushableForKey(cfg.key)
			const nextAll = new Map((state[cfg.key] || []).map((o) => [o.id, o]))
			const next = filterMap(nextAll, isPushable)
			const old = filterMap(prev[cfg.key] || new Map(), isPushable)
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
			it.userId = context.userId
			if (it.op === 'upsert' && it.key !== 'settings') it.obj = { ...it.obj, updatedAt: nowIso }
		}
		if (!batch.length) return
		enqueueing = true
		try {
			if (syncOutbox.enqueue(batch)) { prev = snap(state); prevSettings = state.settings }
		} finally { enqueueing = false }
	})
}

// ── Загрузка с учётом неотправленного ──────────────────────────────────────
export async function cloudLoadMerged(context = getAuthContext()) {
	if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
	await syncOutbox.flushNow().catch(() => {})
	if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
	// Only acknowledgements preceding the pull are covered by this baseline.
	const covered = companyCache.confirmedStockCommands(context)
	const data = await cloudLoadAll(context)
	if (data) companyCache.captureStock(context, data, covered)
	const warehouse = companyCache.readWarehouseSnapshot(context)
	if (warehouse) {
		try { await refreshWarehouseStock(warehouse.coverage.productIds, context) }
		catch (e) { if (!isAuthContextCurrent(context)) throw e; pushEvent('warehouse_reconcile_error', { error: e.message }) }
	}
	const pending = syncOutbox.items().filter((it) => it.userId === context.userId && it.companyId === context.companyId)
	if (data && pending.length) applyPendingToData(data, pending)
	return data ? companyCache.overlayLocal(context, data) : data
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
			if (localWins(it.obj, arr[i])) arr[i] = it.key === 'products' ? mergeProduct(it.obj, arr[i]) : it.obj
		} else arr.push(it.obj)
	}
	return data
}

// ── Компании (тенанты) ───────────────────────────────────────────────────────
// Возвращает объект в старом формате { company_id, role, name, companies:{name} } | null.
export async function getMembership(context = getAuthContext()) {
	const r = await apiListMemberships()
	if (!isAuthContextCurrent(context)) throw new Error('CONTEXT_CHANGED')
	if (!r.ok) throw Object.assign(new Error(r.error?.message || 'Membership lookup failed'), { status: r.status, code: r.error?.code })
	const memberships = r.body?.memberships || []
	const m = context.companyId ? memberships.find((m) => m.companyId === context.companyId) : memberships[0]
	if (!m) return null
	return { company_id: m.companyId, role: m.role, name: m.name, companies: { name: m.companyName, plan: null } }
}

export async function createCompanyCloud(companyName, userName) {
	const r = await apiCreateCompany(companyName, userName)
	if (!r.ok) return { ok: false, error: r.error?.message || 'Не удалось создать компанию' }
	return { ok: true, companyId: r.body?.company?.id }
}

let invitationTail = Promise.resolve(), invitationJob = null
export function acceptInvitation() {
 const proof = getInvitationProof(), context = getAuthContext()
 if (!proof) return Promise.resolve(null)
 if (invitationJob?.revision === proof.revision && invitationJob.generation === context.generation && invitationJob.userId === context.userId && invitationJob.companyId === context.companyId) return invitationJob.promise
 const previous = invitationTail
 const promise = (async () => {
  await previous
  const current = () => isInvitationProofCurrent(proof) && isAuthContextCurrent(context)
  if (!current()) return null
  requireInvitationTransport()
  const r = await apiFetch('POST', '/v1/invitations/accept', { token:proof.token }, { skipCompany:true, context })
  if (!current()) return null
  if (!r.ok) throw new Error(sanitizeSensitiveText(r.error?.message || 'Не удалось принять приглашение'))
  clearInvitationSecret(proof)
  return r.body?.companyId ?? null
 })()
 invitationTail = promise.catch(() => {})
 invitationJob = { revision:proof.revision, generation:context.generation, userId:context.userId, companyId:context.companyId, promise }
 // Avoid retaining completed credentials or a rejected retry job.
 void promise.finally(() => { if (invitationJob?.promise === promise) invitationJob = null }).catch(() => {})
 return promise
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
        expiresAt:i.expiresAt, acceptedAt:i.acceptedAt, revokedAt:i.revokedAt, requiresReissue:i.requiresReissue,
	}))
}
export async function inviteMember(_companyId, email, role, name) {
	try { requireInvitationTransport() } catch (e) { return {ok:false,error:e.message} }
	const r = await apiFetch('POST', '/v1/invitations', { email, role, name })
	if (!r.ok) return { ok: false, error: r.error?.message }
	return { ok: true, token:r.body?.token }
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
	if (!r.ok) {
		pushEvent('sale_error', { orderId: order.id, code: r.error?.code, error: r.error?.message, traceId: r.traceId })
		return { ok: false, error: r.error?.message, code: r.error?.code, details: r.error?.details, traceId: r.traceId }
	}
	return { ok: true, order: r.body?.order, traceId: r.traceId }
}
export async function postDocumentCloud(document) {
	const r = await apiDocument(document, `doc-${document.id}`)
	if (!r.ok) {
		pushEvent('doc_post_error', { docId: document.id, code: r.error?.code, error: r.error?.message, traceId: r.traceId })
		return { ok: false, error: r.error?.message, code: r.error?.code, traceId: r.traceId }
	}
	return { ok: true, document: r.body?.document, traceId: r.traceId }
}
export async function returnCloud({ orderId, items, reason }) {
	const items_key = items ? items.map((i) => `${i.productId}:${i.qty}`).join(',') : 'full'
	const r = await apiReturn({ orderId, items, reason }, `ret-${orderId}-${simpleHash(items_key)}`)
	if (!r.ok) {
		pushEvent('return_error', { orderId, code: r.error?.code, error: r.error?.message, traceId: r.traceId })
		return { ok: false, error: r.error?.message, code: r.error?.code, traceId: r.traceId }
	}
	return { ok: true, orderId: r.body?.orderId, fullyReturned: r.body?.fullyReturned, traceId: r.traceId }
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
	return apiOnAuthChange((event, session, metadata) => cb(event, session, metadata))
}
export async function cloudSignIn(email, password) { return apiSignIn(email, password) }
export async function cloudSignUp(email, password, name, inviteToken) {
	const r = await apiSignUp(email, password, name, inviteToken)
	if (!r.ok) return r
	// Совместимость: старая версия могла вернуть needConfirm — теперь сессия сразу.
	return { ok: true, user: r.user, name }
}
export async function cloudSignOut() { return apiSignOut() }

// Realtime подписка на события компании — используется в UI, чтобы после
// продажи/платежа на другом устройстве немедленно обновить локальный кэш.
export function subscribeToEvents(onEvent) {
	return subscribeEvents(onEvent)
}

export { hasApi as hasCloud, getCompanyId }
