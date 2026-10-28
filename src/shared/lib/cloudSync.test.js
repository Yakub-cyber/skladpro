import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Мок API-клиента ────────────────────────────────────────────────────────
// h.impl подменяется в каждом тесте; log копит вызовы в порядке исполнения.
const h = vi.hoisted(() => ({ impl: null, invitationToken: null, invitationRevision:1, context: { userId: 'u1', companyId: 'c1', generation: 1 } }))

vi.mock('./invitationSecret', () => ({
 getInvitationProof: () => h.invitationToken ? {token:h.invitationToken,revision:h.invitationRevision}:null,
 isInvitationProofCurrent: proof => proof.token === h.invitationToken && proof.revision === h.invitationRevision,
 clearInvitationSecret: () => { h.invitationToken = null },
 requireInvitationTransport: () => {},
}))

vi.mock('@/shared/api', () => ({
	hasApi: true,
	getAuthContext: () => ({ ...h.context }),
	isAuthContextCurrent: (ctx) => ctx.userId === h.context.userId && ctx.companyId === h.context.companyId && ctx.generation === h.context.generation,
	getSession: () => null,
	getCompanyId: () => 'c1',
	onAuthChange: () => () => {},
	apiSignIn: () => Promise.resolve({ ok: true }),
	apiSignUp: () => Promise.resolve({ ok: true }),
	apiSignOut: () => Promise.resolve(),
	apiListMemberships: () => Promise.resolve({ ok: true, body: { memberships: [] } }),
	apiCreateCompany: () => Promise.resolve({ ok: true, body: {} }),
	apiPinVerify: () => Promise.resolve({ ok: false, error: { code: 'PIN_INVALID' } }),
	apiCommercialOrder: (...args) => h.impl.apiCommercialOrder(...args),
	apiSale: (...args) => (h.impl.apiSale ? h.impl.apiSale(...args) : Promise.resolve({ ok: true, body: {} })),
	apiDocument: (...args) => (h.impl.apiDocument ? h.impl.apiDocument(...args) : Promise.resolve({ ok: true, body: {} })),
	apiOrderStatus: (...args) => (h.impl.apiOrderStatus ? h.impl.apiOrderStatus(...args) : Promise.resolve({ ok: true, body: {} })),
	apiReturn: (...args) => h.impl.apiReturn ? h.impl.apiReturn(...args) : Promise.resolve({ ok: true, body: {} }),
	apiFetch: (...args) => h.impl.apiFetch(...args),
	apiSyncPull: (...args) => h.impl.apiSyncPull(...args),
	apiStockReconcile: (...args) => h.impl.apiStockReconcile(...args),
	apiSyncPush: (...args) => h.impl.apiSyncPush(...args),
	apiPutSettings: (...args) => h.impl.apiPutSettings(...args),
}))

import { cloudLoadMerged, cloudReconcileStock, applyPendingToData, syncOutbox, acceptInvitation } from './cloud'
import { companyCache } from './scopedCache'
import { createHash } from 'node:crypto'
import { canonicalPayload } from './outbox'
import { deliveryFingerprint } from './deliveryV2'

// Фабрика мока:
// pullRows — {table: [row,...]} — что вернёт /v1/sync/pull для этой таблицы
// pushResults(ops) — функция, возвращающая массив per-op результатов
// pullError / pushError / settingsError — заставляют вернуть {ok:false}
// settingsData — что вернёт GET /v1/settings
function makeApi({ pullRows = {}, pushResults, pullError, pushError, settingsData = null, settingsError } = {}) {
	const log = []
	return {
		log,
		apiSyncPull: async ({ since, table, limit } = {}) => {
			log.push(['pull', { since, table, limit }])
			if (pullError) return { ok: false, status: 500, error: { code: 'HTTP_500', message: pullError } }
			// Отдаём всё за одну страницу.
			const tables = {}
			for (const [t, rows] of Object.entries(pullRows)) {
				tables[t] = { rows, hasMore: false, cursor: rows.length ? String(rows.length) : null }
			}
			// Для таблиц без данных вернём пустую страницу — cloudLoadAll итерирует по табам сервера
			return { ok: true, status: 200, body: { serverTime: new Date().toISOString(), tables } }
		},
		apiSyncPush: async (ops) => {
			log.push(['push', ops])
			if (pushError) return { ok: false, status: 500, error: { code: 'HTTP_500', message: pushError } }
			const results = pushResults ? pushResults(ops) : ops.map(() => ({ ok: true }))
			return { ok: true, status: 200, body: { results } }
		},
		apiPutSettings: async (data) => {
			log.push(['settings', data])
			if (settingsError) return { ok: false, status: settingsError, error: { message: 'settings err' } }
			return { ok: true, status: 200, body: { ok: true } }
		},
		apiFetch: async (method, path) => {
			log.push(['apiFetch', method, path])
			if (path === '/v1/settings') {
				if (settingsError) return { ok: false, status: settingsError, error: { message: 'settings err' } }
				return { ok: true, status: 200, body: { data: settingsData } }
			}
			return { ok: false, status: 404, error: { code: 'NOT_FOUND' } }
		},
	}
}

const up = (id, obj = {}, key = 'products') => ({
	op: 'upsert',
	key,
	id,
	obj: { id, ...obj },
	companyId: 'c1', userId: 'u1',
})

beforeEach(() => { vi.stubGlobal('navigator', { locks: { request: async (_name, run) => run() } }); syncOutbox.setContext(h.context); syncOutbox.reset() })
afterEach(() => { syncOutbox.reset(); syncOutbox.suspend() })

describe('delivered-v2 exact transport and current-state authority', () => {
  const payload = () => ({ orderId: crypto.randomUUID(), request: { contractVersion: 2, status: 'delivered', shipmentId: crypto.randomUUID(), shipmentFingerprint: 'a'.repeat(64) } })
  const commercial = { items: [{ lineId: 'line', productId: 'p', unitId: 'u', unitFactor: '1', qtyBase: '2', qtyInput: '2', price: '50' }], subtotal: '100', total: '100', discount: { kind: 'percent', value: '0' }, rounding: 'ruble', onCredit: true, payment: { method: 'credit', cashPaid: '0', cardPaid: '0', change: '0' }, vatSummary: null, creditTerms: null }
  const native = (p, status = 'delivered', version = '40') => ({ id: p.orderId, row_version: version, status, stock_consumed: true, shipment_doc_id: `shipment-${p.request.shipmentId}`, commercial_snapshot: commercial })
  const receipt = async p => ({ ok: true, contractVersion: 2, commandId: `delivered:${p.request.shipmentId}`, shipmentId: p.request.shipmentId,
    documentId: `shipment-${p.request.shipmentId}`, order: { id: p.orderId, status: 'delivered', rowVersion: '40' }, deliveredAt: new Date().toISOString(), fingerprint: await deliveryFingerprint({ companyId: h.context.companyId, orderId: p.orderId, ...p.request }) })
  it('lost committed response retries the exact body/key and accepts only persisted current server state', async () => {
    const { enqueueDelivery } = await import('./cloud'), p = payload(), calls = []; let lost = true
    const body = await receipt(p)
    h.impl = { ...makeApi({ pullRows: { orders: [native(p)] } }), apiOrderStatus: async (...args) => { calls.push(args); if (lost) { lost = false; throw Error('lost response') } return { ok: true, body } } }
    await enqueueDelivery(p); await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(1)
    await syncOutbox.flushNow(); expect(calls[0]).toEqual(calls[1]); expect(calls[0].slice(0,3)).toEqual([p.orderId,p.request,`delivered:${p.request.shipmentId}`])
    expect(syncOutbox.items()).toHaveLength(0); expect(companyCache.commercialOrder(h.context,p.orderId).status).toBe('delivered')
  })
  it('an old receipt cannot restore delivered over a later cancellation', async () => {
    const { enqueueDelivery } = await import('./cloud'), p = payload(), body = await receipt(p)
    h.impl = { ...makeApi({ pullRows: { orders: [native(p,'cancelled','50')] } }), apiOrderStatus: async () => ({ ok: true, body }) }
    await enqueueDelivery(p); await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(0); expect(companyCache.commercialOrder(h.context,p.orderId).status).toBe('cancelled')
  })
  it('a missing current read, stale version or unverified response keeps the immutable command', async () => {
    const { enqueueDelivery } = await import('./cloud')
    for (const failure of ['read','stale','receipt']) {
      syncOutbox.reset(); const p = payload(), body = await receipt(p)
      h.impl = { ...makeApi({ pullRows: { orders: [native(p,'shipped','30')] }, ...(failure === 'read' ? { pullError: 'offline' } : {}) }), apiOrderStatus: async () => ({ ok: true, body: failure === 'receipt' ? { ...body, fingerprint: 'wrong' } : body }) }
      await enqueueDelivery(p); await syncOutbox.flushNow(); expect(syncOutbox.items()[0].obj).toEqual(p)
    }
  })
  it.each([409,422])('HTTP %s retains command/error and refreshes actual order without automatic retry', async status => {
    const { enqueueDelivery } = await import('./cloud'), p = payload(), send = vi.fn(async () => ({ ok: false, status, headers: { 'idempotency-replayed': 'true' }, error: { code: 'DELIVERY_STATUS_CONFLICT', message: 'order cancelled' } }))
    h.impl = { ...makeApi({ pullRows: { orders: [native(p,'cancelled','50')] } }), apiOrderStatus: send }
    await enqueueDelivery(p); await syncOutbox.flushNow(); await syncOutbox.flushNow(); expect(send).toHaveBeenCalledTimes(1)
    expect(syncOutbox.items()[0]).toMatchObject({ obj: p, _quarantined: true, _quarantineReason: { code: 'DELIVERY_STATUS_CONFLICT' } }); expect(companyCache.commercialOrder(h.context,p.orderId).status).toBe('cancelled')
  })
  it.each(['logout','company'])('a late response after %s cannot acknowledge or persist into another context', async change => {
    const { enqueueDelivery } = await import('./cloud'), p = payload(), owner = { ...h.context }, body = await receipt(p)
    h.impl = { ...makeApi(), apiOrderStatus: async () => { h.context = change === 'logout' ? { userId: null, companyId: null, generation: owner.generation + 1 } : { ...owner, companyId: 'other-company', generation: owner.generation + 1 }; return { ok: true, body } } }
    await enqueueDelivery(p); await syncOutbox.flushNow(); h.context = owner
    expect(syncOutbox.items()).toHaveLength(1); expect(companyCache.commercialOrder(owner,p.orderId)).toBe(null)
  })
  it('a verified delivery is not acknowledged when persisting the current order fails', async () => {
    const { enqueueDelivery } = await import('./cloud'), p = payload(), body = await receipt(p)
    h.impl = { ...makeApi({ pullRows: { orders: [native(p)] } }), apiOrderStatus: async () => ({ ok: true, body }) }
    const save = vi.spyOn(companyCache, 'saveCommercialOrder').mockImplementationOnce(() => { throw Error('quota') })
    try { await enqueueDelivery(p); await syncOutbox.flushNow(); expect(syncOutbox.items()[0].obj).toEqual(p) }
    finally { save.mockRestore() }
  })
})

describe('commercial-v2 exact transport and permanent replay', () => {
  const commercial = () => ({ items: [{ lineId: 'line', productId: 'p', unitId: 'u', unitFactor: '1', qtyBase: '2', qtyInput: '2', price: '50' }], subtotal: '100', total: '100', discount: { kind: 'percent', value: '0' }, rounding: 'ruble', onCredit: false, payment: { method: 'unpaid', cashPaid: '0', cardPaid: '0', change: '0' }, vatSummary: null, creditTerms: null })
  const request = () => ({ contractVersion: 2, commandId: crypto.randomUUID(), orderId: crypto.randomUUID(), commercial: commercial() })
  const receipt = (p, version = '20') => ({ ok: true, contractVersion: 2, commandId: p.commandId, order: { id: p.orderId, rowVersion: version, commercial: p.commercial }, fingerprint: createHash('sha256').update(canonicalPayload({ companyId: 'c1', operation: 'create', ...p })).digest('hex') })
  const native = (p, version = '20', c = p.commercial) => ({ id: p.orderId, row_version: version, commercial_snapshot: c, status: 'new' })
  it('retries the same envelope/key after commit-response loss and saves current truth before ack', async () => {
    const { enqueueCommercialOrder } = await import('./cloud'); const p = request(), calls = []; let lost = true
    h.impl = { ...makeApi({ pullRows: { orders: [native(p)] } }), apiCommercialOrder: async (...args) => { calls.push(args); if (lost) { lost = false; throw Error('lost'); } return { ok: true, body: receipt(p) } } }
    await enqueueCommercialOrder('commercial_create', p); await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(1)
    await syncOutbox.flushNow(); expect(calls[0]).toEqual(calls[1]); expect(calls[0].slice(0, 3)).toEqual(['create', p, `commercial:${p.commandId}`]); expect(syncOutbox.items()).toHaveLength(0)
    expect(companyCache.commercialOrder(h.context, p.orderId)).toMatchObject({ rowVersion: '20', snapshot: p.commercial })
  })
  it('old receipt never overwrites the more recent native composition', async () => {
    const { enqueueCommercialOrder } = await import('./cloud'); const p = request(), newer = { ...p.commercial, no: 'newer' }
    h.impl = { ...makeApi({ pullRows: { orders: [native(p, '30', newer)] } }), apiCommercialOrder: async () => ({ ok: true, body: receipt(p) }) }
    await enqueueCommercialOrder('commercial_create', p); await syncOutbox.flushNow()
    expect(companyCache.commercialOrder(h.context, p.orderId)).toMatchObject({ rowVersion: '30', snapshot: newer }); expect(syncOutbox.items()).toHaveLength(0)
  })
  it.each([409, 422])('keeps HTTP %s and its diagnostic without automatic retry', async status => {
    const { enqueueCommercialOrder } = await import('./cloud'); const p = request(), send = vi.fn(async () => ({ ok: false, status, error: { code: `COMMERCIAL_${status}`, message: 'requires review' } }))
    h.impl = { ...makeApi(), apiCommercialOrder: send }; await enqueueCommercialOrder('commercial_create', p); await syncOutbox.flushNow(); await syncOutbox.flushNow()
    expect(send).toHaveBeenCalledTimes(1); expect(syncOutbox.items()[0]).toMatchObject({ obj: p, _quarantined: true, _quarantineReason: { code: `COMMERCIAL_${status}` } })
  })
  it('does not accept a receipt if current server version cannot be fetched', async () => {
    const { enqueueCommercialOrder } = await import('./cloud'); const p = request()
    h.impl = { ...makeApi({ pullError: 'offline' }), apiCommercialOrder: async () => ({ ok: true, body: receipt(p) }) }
    await enqueueCommercialOrder('commercial_create', p); await syncOutbox.flushNow(); expect(syncOutbox.items()[0].obj).toEqual(p)
  })
  it('does not accept a late commercial response into another company', async () => {
    const { enqueueCommercialOrder } = await import('./cloud'); const p = request(), original = { ...h.context }
    h.impl = { ...makeApi(), apiCommercialOrder: async () => { h.context = { ...h.context, companyId: 'other', generation: h.context.generation + 1 }; return { ok: true, body: receipt(p) } } }
    await enqueueCommercialOrder('commercial_create', p); await syncOutbox.flushNow()
    h.context = original
    expect(syncOutbox.items()).toHaveLength(1); expect(companyCache.commercialOrder(h.context, p.orderId)).toBe(null)
  })
  it('uses individual cursors for complete commercial orders and product unit catalogs', async () => {
    const { cloudLoadAll } = await import('./cloud'), calls = []
    h.impl = { ...makeApi(), apiSyncPull: async params => {
      calls.push(params)
      return { ok: true, body: { tables: !params.table ? {
        products: { rows: [{ id: 'p', unit: 'шт' }], hasMore: false, cursor: '900' },
        product_units: { rows: [{ id: 'pack', product_id: 'p', name: 'pack', factor: '12', is_base: false }], hasMore: true, cursor: '2' },
        orders: { rows: [], hasMore: true, cursor: '1' },
      } : params.table === 'product_units' ? { product_units: { rows: [{ id: 'base', product_id: 'p', name: 'шт', factor: '1', is_base: true }], hasMore: false, cursor: '3' } }
        : { orders: { rows: [{ id: 'historical', items: [] }], hasMore: false, cursor: '4' } } } }
    } }
    const result = await cloudLoadAll()
    expect(result.products[0].serverUnits).toHaveLength(2); expect(result.orders[0].id).toBe('historical')
    expect(calls.slice(1).map(c => [c.table, c.since])).toEqual([['product_units', '2'], ['orders', '1']])
  })
  it('quarantines a legacy write to a protected order without sending it through sync/push', async () => {
    const p = request(); companyCache.saveCommercialOrder(h.context, { id: p.orderId, rowVersion: '20', commercialSnapshot: p.commercial, status: 'new' }); h.impl = makeApi()
    syncOutbox.enqueue([up(p.orderId, { items: [] }, 'orders')]); await syncOutbox.flushNow()
    expect(h.impl.log.filter(c => c[0] === 'push')).toEqual([]); expect(syncOutbox.items()[0]._quarantined).toBe(true)
  })
})

describe('shipment-v2 transport', () => {
  it('a late response after logout does not acknowledge the original shipment', async () => {
    const { enqueueShipment } = await import('./cloud'), original = { ...h.context }, p = { contractVersion: 2, status: 'shipped', shipmentId: crypto.randomUUID(), warehouseId: 'A', orderSnapshot: { items: [{ productId: 'p' }] } }
    h.impl = { ...makeApi(), apiOrderStatus: async () => { h.context = { userId: null, companyId: null, generation: original.generation + 1 }; return { ok: true, body: {} } } }
    await enqueueShipment('late-order', p); await syncOutbox.flushNow(); h.context = original
    expect(syncOutbox.items()).toHaveLength(1); expect(companyCache.commercialOrder(h.context, 'late-order')).toBe(null)
  })
  it.each([409, 422])('preserves HTTP %s commands and never retries quarantine automatically', async status => {
    const { enqueueShipment } = await import('./cloud'), p = { contractVersion: 2, status: 'shipped', shipmentId: crypto.randomUUID(), warehouseId: 'A', orderSnapshot: { items: [{ productId: 'p' }] } }
    const send = vi.fn(async () => ({ ok: false, status, error: { code: 'SHIPMENT_CONFLICT', message: 'review required' } }))
    h.impl = { ...makeApi(), apiOrderStatus: send }; await enqueueShipment('order', p); await syncOutbox.flushNow(); await syncOutbox.flushNow()
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0].slice(0,3)).toEqual(['order',p,`shipment:${p.shipmentId}`]); expect(syncOutbox.items()[0]).toMatchObject({ obj: p, _quarantined: true })
  })
  it('a successful unverified shipment receipt never removes the command', async () => {
    const { enqueueShipment } = await import('./cloud'), p = { contractVersion: 2, status: 'shipped', shipmentId: crypto.randomUUID(), warehouseId: 'A', orderSnapshot: { items: [{ productId: 'p' }] } }
    h.impl = { ...makeApi(), apiOrderStatus: async () => ({ ok: true, body: {} }) }; await enqueueShipment('order',p); await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(1)
  })
})

describe('sale-v2 transport confirmation', () => {
  const payload = () => ({ contractVersion: 2, order: { id: 'v2-sale', warehouseId: 'A', items: [{ productId: 'p', qty: 2, price: 50 }], discount: 0, onCredit: false } })
  const receipt = (p) => ({ ok: true, contractVersion: 2, documentId: `sale-${p.order.id}`, warehouseId: 'A', order: { id: p.order.id },
    fingerprint: createHash('sha256').update(canonicalPayload({ contractVersion: 2, companyId: h.context.companyId, order: p.order })).digest('hex'),
    items: [{ saleLineId: `sale-${p.order.id}-0`, productId: 'p', qtyBase: '2.0000' }] })
  it('sends the saved envelope and key unchanged, accepting only a verified receipt', async () => {
    const { enqueueSale } = await import('./cloud')
    const p = payload(), calls = []; h.impl = { ...makeApi(), apiSale: async (saved, key) => { calls.push({ saved, key }); return { ok: true, body: receipt(saved) } } }
    await enqueueSale(p); await syncOutbox.flushNow()
    expect(calls).toEqual([{ saved: p, key: 'sale-v2-sale' }]); expect(syncOutbox.items()).toHaveLength(0)
  })
  it('keeps a successful but unverified response in quarantine', async () => {
    const { enqueueSale } = await import('./cloud')
    h.impl = { ...makeApi(), apiSale: async () => ({ ok: true, body: {} }) }
    await enqueueSale(payload()); await syncOutbox.flushNow()
    expect(syncOutbox.quarantined()[0]._quarantineReason.code).toBe('SALE_RESPONSE_UNVERIFIED')
  })
  it('cannot acknowledge a v2 conflict through a replay header', async () => {
    const { enqueueSale } = await import('./cloud')
    h.impl = { ...makeApi(), apiSale: async () => ({ ok: false, status: 409, headers: { 'idempotency-replayed': 'true' }, error: { code: 'SALE_IDENTITY_CONFLICT' } }) }
    await enqueueSale(payload()); await syncOutbox.flushNow()
    expect(syncOutbox.quarantined()[0]._quarantineReason.code).toBe('SALE_IDENTITY_CONFLICT')
  })
})

describe('cloudLoadMerged — порядок bootstrap', () => {
	it('explicit warehouse reconciliation persists a separate snapshot without flushing outbox', async () => {
		h.impl = makeApi()
		h.impl.apiStockReconcile = async (request, context) => {
			expect(context).toEqual(h.context)
			return { ok: true, body: { contractVersion: 1, requestId: request.requestId, companyId: context.companyId,
				snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot',
				coverage: { productIds: ['p1'], complete: true, missingBalanceMeansZero: true, warehouseScope: 'all-company-warehouses' },
				warehouses: [{ id: 'w1', active: true }], balances: [], totals: [{ productId: 'p1', qtyBase: '0' }], commands: [] } }
		}
		syncOutbox.enqueue([up('p1', { name: 'pending' })])
		const before = JSON.stringify(syncOutbox.items())
		const snapshot = await cloudReconcileStock({ productIds: ['p1'] })
		expect(companyCache.readWarehouseSnapshot(h.context)).toEqual(snapshot)
		expect(JSON.stringify(syncOutbox.items())).toBe(before)
		expect(h.impl.log).toEqual([])
	})
	it('сначала досылает очередь (push), потом читает сервер (pull)', async () => {
		h.impl = makeApi({ pullRows: { products: [{ id: 'p1', name: 'Серверный' }] } })
		syncOutbox.enqueue([up('p1', { name: 'Локальный', stock: 5 })])

		const data = await cloudLoadMerged()

		const firstPull = h.impl.log.findIndex(([op]) => op === 'pull')
		const firstPush = h.impl.log.findIndex(([op]) => op === 'push')
		expect(firstPush).toBeGreaterThanOrEqual(0)
		expect(firstPush).toBeLessThan(firstPull) // очередь ушла ДО чтения
		expect(syncOutbox.status().pending).toBe(0)
		expect(data.products).toHaveLength(1)
	})

	it('офлайн: сервер прочитан, но неотправленное наложено поверх', async () => {
		h.impl = makeApi({
			pullRows: {
				products: [
					{ id: 'p1', name: 'Серверный', stock: 99 },
					{ id: 'p3', name: 'Удалён локально' },
				],
			},
			pushError: 'fetch failed',
		})
		syncOutbox.enqueue([
			up('p1', { name: 'Локальный', stock: 5 }),
			up('p2', { name: 'Новый локальный' }),
			{ op: 'delete', key: 'products', id: 'p3', companyId: 'c1', userId: 'u1' },
		])

		const data = await cloudLoadMerged()

		expect(syncOutbox.status().pending).toBe(3) // очередь цела, доставит позже
		expect(syncOutbox.status().state).toBe('error')
		const byId = Object.fromEntries(data.products.map((p) => [p.id, p]))
		expect(byId.p1.name).toBe('Локальный')
		expect(byId.p2).toBeTruthy()
		expect(byId.p3).toBeUndefined()
	})

	it('подтягивает настройки компании (GET /v1/settings)', async () => {
		h.impl = makeApi({
			pullRows: { products: [{ id: 'p1' }] },
			settingsData: { company: 'ООО Облако', currency: '₽' },
		})
		const data = await cloudLoadMerged()
		expect(data.settings).toEqual({ company: 'ООО Облако', currency: '₽' })
	})
})

describe('sendBatch (через outbox) — классификация ошибок', () => {
	it('терминальная ошибка per-op сохраняется в карантине', async () => {
		h.impl = makeApi({ pushResults: () => [{ ok: false, code: 'STALE', error: 'server newer' }] })
		syncOutbox.enqueue([up('p1')])
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 1, quarantined: 1, state: 'attention' })
	})

	it('транспортная ошибка (сеть/5xx) → элемент остаётся и статус error', async () => {
		h.impl = makeApi({ pushError: 'timeout' })
		syncOutbox.enqueue([up('p1')])
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 1, state: 'error' })
	})

	it('настройки уезжают через apiPutSettings(data) — без company_id (сервер знает по токену)', async () => {
		h.impl = makeApi()
		syncOutbox.enqueue([
			{ op: 'upsert', key: 'settings', id: 'c1', obj: { company: 'X' }, companyId: 'c1', userId: 'u1' },
		])
		await syncOutbox.flushNow()
		const call = h.impl.log.find(([op]) => op === 'settings')
		expect(call).toBeTruthy()
		expect(call[1]).toEqual({ company: 'X' }) // ровно data, без обёртки
	})

	it('удаления уезжают отдельными op-ами в один push-батч', async () => {
		h.impl = makeApi()
		syncOutbox.enqueue([
			{ op: 'delete', key: 'products', id: 'p1', companyId: 'c1', userId: 'u1' },
			{ op: 'delete', key: 'products', id: 'p2', companyId: 'c1', userId: 'u1' },
		])
		await syncOutbox.flushNow()
		const call = h.impl.log.find(([op]) => op === 'push')
		expect(call).toBeTruthy()
		const ops = call[1]
		expect(ops).toHaveLength(2)
		expect(ops.every((o) => o.op === 'delete' && o.table === 'products')).toBe(true)
		expect(ops.map((o) => o.row.id).sort()).toEqual(['p1', 'p2'])
	})

	it('таблицы вне push-whitelist (movements/audit/documents) → сразу dropped, не отправляются', async () => {
		h.impl = makeApi()
		syncOutbox.enqueue([
			{ op: 'upsert', key: 'movements', id: 'm1', obj: { id: 'm1' }, companyId: 'c1', userId: 'u1' },
			{ op: 'upsert', key: 'audit', id: 'a1', obj: { id: 'a1' }, companyId: 'c1', userId: 'u1' },
		])
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 2, quarantined: 2, state: 'attention' })
		// Ничего не отправлено, операции сохранены в карантине.
		const pushCalls = h.impl.log.filter(([op]) => op === 'push')
		expect(pushCalls).toHaveLength(0)
	})
})

describe('PIN сотрудника не уходит в облако и не приходит обратно', () => {
	it('upsert employees: поле pin вырезано из payload', async () => {
		h.impl = makeApi()
		syncOutbox.enqueue([
			{
				op: 'upsert',
				key: 'employees',
				id: 'e1',
				obj: { id: 'e1', name: 'Аюб', role: 'admin', pin: '1111', active: true },
				companyId: 'c1', userId: 'u1',
			},
		])
		await syncOutbox.flushNow()
		const call = h.impl.log.find(([op]) => op === 'push')
		const row = call[1][0].row
		expect(row.pin).toBeUndefined()
		expect(row.name).toBe('Аюб')
		expect(row.id).toBe('e1')
	})

	it('cloudLoadMerged: серверный pin_hash (если бы протёк) не попадает в стор', async () => {
		h.impl = makeApi({
			pullRows: {
				employees: [{ id: 'e1', name: 'Аюб', role: 'admin', pin: 'server-secret', pin_hash: 'bcrypt' }],
			},
		})
		const data = await cloudLoadMerged()
		expect(data.employees).toHaveLength(1)
		expect(data.employees[0].pin).toBeUndefined()
		expect(data.employees[0].pinHash).toBeUndefined()
		expect(data.employees[0].name).toBe('Аюб')
	})
})

describe('applyPendingToData — чистая функция оверлея', () => {
	it('upsert заменяет по id или добавляет; delete убирает; settings мержится', () => {
		const data = {
			products: [{ id: 'p1', stock: 1 }, { id: 'p2', stock: 2 }],
			settings: { company: 'Сервер', currency: '$' },
		}
		applyPendingToData(data, [
			up('p1', { stock: 100 }),
			up('p9', { stock: 9 }),
			{ op: 'delete', key: 'products', id: 'p2', companyId: 'c1', userId: 'u1' },
			{ op: 'upsert', key: 'settings', id: 'c1', obj: { currency: '₽' }, companyId: 'c1', userId: 'u1' },
			{ op: 'upsert', key: 'нет_такой', id: 'x', obj: {}, companyId: 'c1', userId: 'u1' }, // не падает
		])
		expect(data.products.map((p) => p.id).sort()).toEqual(['p1', 'p9'])
		expect(data.products.find((p) => p.id === 'p1').stock).toBe(1)
		expect(data.settings).toEqual({ company: 'Сервер', currency: '₽' })
	})

	it('сравнение по updatedAt: свежий сервер побеждает устаревший локальный', () => {
		const data = { products: [{ id: 'p1', stock: 200, updatedAt: '2026-07-13T12:00:00Z' }] }
		applyPendingToData(data, [up('p1', { stock: 5, updatedAt: '2026-07-13T10:00:00Z' })])
		expect(data.products[0].stock).toBe(200)
	})

	it('сравнение по updatedAt: свежий локальный каталог не заменяет серверный остаток', () => {
		const data = { products: [{ id: 'p1', stock: 200, updatedAt: '2026-07-13T10:00:00Z' }] }
		applyPendingToData(data, [up('p1', { stock: 5, updatedAt: '2026-07-13T12:00:00Z' })])
		expect(data.products[0].stock).toBe(200)
	})

	it('без updatedAt серверный остаток также защищён', () => {
		const data = { products: [{ id: 'p1', stock: 200 }] }
		applyPendingToData(data, [up('p1', { stock: 5 })])
		expect(data.products[0].stock).toBe(200)
	})

	it('delete всегда применяется, даже если серверная запись свежее', () => {
		const data = { products: [{ id: 'p1', updatedAt: '2026-07-13T12:00:00Z' }] }
		applyPendingToData(data, [{ op: 'delete', key: 'products', id: 'p1', companyId: 'c1', userId: 'u1' }])
		expect(data.products).toHaveLength(0)
	})
})

describe('attachSync штампует updatedAt при отправке', () => {
	it('upsert в очередь получает updatedAt (ISO), settings — не получает', async () => {
		const { attachSync } = await import('./cloud.js')
		const listeners = new Set()
		let state = {
			companyId: 'c1', userId: 'u1', authAccountId: 'u1', cloudReady: true,
			products: [{ id: 'p1', name: 'A' }],
			settings: { company: 'X' },
		}
		for (const k of [
			'priceTypes','warehouses','cells','customers','suppliers',
			'employees','orders','invoices','documents','movements','shifts','audit',
		]) state[k] = []
		const store = {
			getState: () => state,
			setState: (patch) => {
				state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
			},
			subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
		}
		syncOutbox.reset()
		h.impl = makeApi() // тихий фейк
		attachSync(store)
		state = { ...state, products: [{ id: 'p1', name: 'A2' }] }
		for (const cb of listeners) cb(state)
		const items = syncOutbox.items()
		const upsert = items.find((it) => it.op === 'upsert' && it.key === 'products')
		expect(upsert).toBeTruthy()
		expect(upsert.obj.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
		const s = items.find((it) => it.key === 'settings')
		if (s) expect(s.obj.updatedAt).toBeUndefined()
		syncOutbox.reset()
	})
})

// ── Retail-заказы не должны попадать в sync/push ни как upsert, ни как delete ─
// Без симметричного фильтра detect-delete увидел бы «был в prev, нет в next»
// и стёр бы заказ на сервере, куда его положил /v1/sales. Проверяем оба конца.
describe('attachSync: retail-заказы исключены СИММЕТРИЧНО (upsert + delete)', () => {
	beforeEach(async () => {
		const mod = await import('./cloud.js')
		mod.__resetSyncForTests()
		syncOutbox.reset()
	})
	function makeStore(initial) {
		const listeners = new Set()
		let state = {
			companyId: 'c1', userId: 'u1', authAccountId: 'u1', cloudReady: true,
			settings: { company: 'X' },
		}
		for (const k of [
			'priceTypes', 'warehouses', 'cells', 'products', 'customers', 'suppliers',
			'employees', 'orders', 'invoices', 'documents', 'movements', 'shifts', 'audit',
		]) state[k] = []
		state = { ...state, ...initial }
		return {
			get state() { return state },
			getState: () => state,
			setState: (patch) => {
				state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
			},
			subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
			trigger: () => { for (const cb of listeners) cb(state) },
			setOrders: (orders) => {
				state = { ...state, orders }
				for (const cb of listeners) cb(state)
			},
		}
	}

  it('protected commercial orders never generate legacy upserts or deletes', async () => {
    const { attachSync } = await import('./cloud.js'); h.impl = makeApi()
    const order = { id: 'commercial-protected', commercialContractVersion: 2, kind: 'order', status: 'new', total: 100 }
    const store = makeStore({ orders: [order] }); attachSync(store)
    store.setOrders([{ ...order, total: 200 }]); expect(syncOutbox.items().filter(op => op.key === 'orders')).toEqual([])
    store.setOrders([]); expect(syncOutbox.items().filter(op => op.key === 'orders')).toEqual([])
  })
	it('удаление retail-заказа из state НЕ создаёт delete-op в очереди', async () => {
		syncOutbox.reset()
		const { attachSync } = await import('./cloud.js')
		h.impl = makeApi()
		const store = makeStore({
			orders: [
				{ id: 'r1', kind: 'retail', status: 'delivered', total: 100 },
				{ id: 'r2', kind: 'retail', status: 'delivered', total: 200 },
				{ id: 'd1', kind: 'order', status: 'new', total: 300 },
			],
		})
		attachSync(store)
		// Симулируем физическое исчезновение retail-заказа r1 из state
		// (например, cloud-load вернул меньше заказов — набор компаний
		// сменился, или разработчик почистил стор).
		store.setOrders([
			{ id: 'r2', kind: 'retail', status: 'delivered', total: 200 },
			{ id: 'd1', kind: 'order', status: 'new', total: 300 },
		])
		const items = syncOutbox.items()
		// Ни одного delete по orders вообще быть не должно — r1 retail,
		// сервер владеет им сам через /v1/sales/status.
		const deletes = items.filter((it) => it.op === 'delete' && it.key === 'orders')
		expect(deletes).toEqual([])
		syncOutbox.reset()
	})

	it('удаление НЕ-retail заказа (kind=order) по-прежнему создаёт delete', async () => {
		syncOutbox.reset()
		const { attachSync } = await import('./cloud.js')
		h.impl = makeApi()
		const store = makeStore({
			orders: [{ id: 'd1', kind: 'order', status: 'new', total: 300 }],
		})
		attachSync(store)
		store.setOrders([]) // удалили delivery-заказ
		const items = syncOutbox.items()
		const deletes = items.filter((it) => it.op === 'delete' && it.key === 'orders')
		expect(deletes).toHaveLength(1)
		expect(deletes[0].id).toBe('d1')
		syncOutbox.reset()
	})

	it('новая retail-продажа в state — НЕ уезжает через sync/push (upsert подавлен)', async () => {
		syncOutbox.reset()
		const { attachSync } = await import('./cloud.js')
		h.impl = makeApi()
		const store = makeStore({ orders: [] })
		attachSync(store)
		store.setOrders([
			{ id: 'r_new', kind: 'retail', status: 'delivered', total: 500 },
		])
		const items = syncOutbox.items()
		const upserts = items.filter((it) => it.op === 'upsert' && it.key === 'orders')
		expect(upserts).toEqual([])
		syncOutbox.reset()
	})

	it('заказ с shipmentDocId (любой kind) — не уходит ни upsert, ни delete', async () => {
		syncOutbox.reset()
		const { attachSync } = await import('./cloud.js')
		h.impl = makeApi()
		// kind='order', но отгружен серверным путём: маркер, не тип, решает.
		const shipped = { id: 'd_ship', kind: 'order', status: 'delivered', shipmentDocId: 'sale-d_ship', total: 700 }
		const store = makeStore({ orders: [shipped] })
		attachSync(store)
		// Изменение полей — upsert подавлен.
		store.setOrders([{ ...shipped, total: 800 }])
		// Исчезновение — delete подавлен.
		store.setOrders([])
		const items = syncOutbox.items()
		expect(items.filter((it) => it.key === 'orders')).toEqual([])
		syncOutbox.reset()
	})

	it('добавление delivery-заказа (kind=order) — upsert летит как обычно', async () => {
		syncOutbox.reset()
		const { attachSync } = await import('./cloud.js')
		h.impl = makeApi()
		const store = makeStore({ orders: [] })
		attachSync(store)
		store.setOrders([
			{ id: 'd_new', kind: 'order', status: 'new', total: 500, no: 'ЗК-42' },
		])
		const items = syncOutbox.items()
		const upserts = items.filter((it) => it.op === 'upsert' && it.key === 'orders')
		expect(upserts).toHaveLength(1)
		expect(upserts[0].id).toBe('d_new')
		syncOutbox.reset()
	})
})

// ── Бизнес-очередь: продажа/отмена/документ через outbox ────────────────────
// Смысл этой очереди — гарантировать доставку после закрытия вкладки.
// Fire-and-forget (sellCloud().then()) терял операцию при закрытии страницы;
// сейчас каждая продажа/отмена/документ живёт в localStorage до подтверждения.
describe('outbox: бизнес-операции (sale/order_status/doc_post)', () => {
	it('a quarantined inventory blocks its successor while another warehouse and settings keep syncing', async () => {
		const { enqueueDocument } = await import('./cloud.js')
		const calls = []
		h.impl = { ...makeApi(), apiDocument: async (payload) => {
			calls.push(payload.id)
			return payload.id === 'inv1' ? { ok: false, status: 409, error: { code: 'STALE' } } : { ok: true }
		} }
		const doc = (id, warehouseId) => ({ id, type: 'adjust', warehouseId, items: [{ productId: 'p1', qty: 30 }] })
		await enqueueDocument(doc('inv1', 'a')); await enqueueDocument(doc('inv2', 'a')); await enqueueDocument(doc('independent', 'b'))
		syncOutbox.enqueue([{ userId: h.context.userId, companyId: h.context.companyId, id: 'settings', key: 'settings', obj: { currency: 'RUB' } }])
		await syncOutbox.flushNow(); await syncOutbox.flushNow()
		expect(calls).toEqual(['inv1', 'independent'])
		expect(syncOutbox.blocked()[0]).toMatchObject({ id: 'inv2', predecessorId: 'inv1', reason: 'STALE' })
		expect(h.impl.log.some(([kind]) => kind === 'settings')).toBe(true)
	})
	it('an ambiguous network result blocks dependent business but still allows independent business and catalogue', async () => {
		const { enqueueDocument } = await import('./cloud.js'), calls = []
		h.impl = { ...makeApi(), apiDocument: async (payload) => {
			calls.push(payload.id)
			if (payload.id === 'inv1') throw new Error('lost response')
			return { ok: true }
		} }
		await enqueueDocument({ id: 'inv1', type: 'adjust', warehouseId: 'a', items: [{ productId: 'p1', qty: 30 }] })
		await enqueueDocument({ id: 'inv2', type: 'adjust', warehouseId: 'a', items: [{ productId: 'p1', qty: 25 }] })
		await enqueueDocument({ id: 'independent', type: 'adjust', warehouseId: 'b', items: [{ productId: 'p1', qty: 20 }] })
		syncOutbox.enqueue([up('catalog', { name: 'catalog' })])
		await syncOutbox.flushNow()
		expect(calls).toEqual(['inv1', 'independent'])
		expect(h.impl.log.some(([kind]) => kind === 'push')).toBe(true)
		expect(syncOutbox.blocked().map((c) => c.id)).toEqual(['inv2'])
	})
	it('потерянный HTTP-ответ: повтор sale сохраняет payload и ключ, сервер применяет один раз', async () => {
		const { enqueueSale } = await import('./cloud.js')
		const server = new Map(), calls = []
		let loseResponse = true
		h.impl = { ...makeApi(), apiSale: async (payload, key) => {
			calls.push({ key, payload: JSON.stringify(payload) })
			if (!server.has(key)) server.set(key, JSON.stringify(payload))
			else expect(server.get(key)).toBe(JSON.stringify(payload))
			if (loseResponse) { loseResponse = false; throw new Error('response lost') }
			return { ok: true, body: {}, headers: { 'idempotency-replayed': 'true' } }
		} }
		await enqueueSale({ id: 'lost-response', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(1)
		await syncOutbox.flushNow(); expect(syncOutbox.items()).toEqual([])
		expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1])
		expect(calls[0].key).toBe('sale-lost-response'); expect(server.size).toBe(1)
	})
	it('enqueueSale → apiSale вызывается с order + idempotency-ключом', async () => {
		const { enqueueSale } = await import('./cloud.js')
		const calls = []
		h.impl = {
			...makeApi(),
			apiSale: async (order, idemKey) => {
				calls.push({ order, idemKey })
				return { ok: true, body: {} }
			},
		}
		await enqueueSale({ id: 'o1', no: 'ЧК-1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		expect(calls).toHaveLength(1)
		expect(calls[0].order.id).toBe('o1')
		expect(calls[0].idemKey).toBe('sale-o1')
		expect(syncOutbox.status().pending).toBe(0)
	})

	it('enqueueOrderStatus → apiOrderStatus, ключ по (orderId, status)', async () => {
		const { enqueueOrderStatus } = await import('./cloud.js')
		const calls = []
		h.impl = {
			...makeApi(),
			apiOrderStatus: async (orderId, status, idemKey) => {
				calls.push({ orderId, status, idemKey })
				return { ok: true, body: {} }
			},
		}
		await enqueueOrderStatus('o1', 'cancelled')
		await syncOutbox.flushNow()
		expect(calls).toEqual([{ orderId: 'o1', status: 'cancelled', idemKey: 'ost-o1-cancelled' }])
	})

	it('sale → 5xx: элемент остаётся в очереди для ретрая', async () => {
		const { enqueueSale } = await import('./cloud.js')
		let attempts = 0
		h.impl = {
			...makeApi(),
			apiSale: async () => {
				attempts += 1
				return { ok: false, status: 502, error: { code: 'BAD_GATEWAY', message: '502' } }
			},
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		expect(attempts).toBe(1)
		expect(syncOutbox.status()).toMatchObject({ pending: 1, state: 'error' })
	})

	it('sale → сеть: остаётся в очереди', async () => {
		const { enqueueSale } = await import('./cloud.js')
		h.impl = {
			...makeApi(),
			apiSale: async () => { throw new Error('fetch failed') },
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 1, state: 'error' })
	})

	it('sale → 400: карантин (payload сохранён с traceId), НЕ silent drop', async () => {
		const { enqueueSale } = await import('./cloud.js')
		h.impl = {
			...makeApi(),
			apiSale: async () => ({
				ok: false, status: 400, traceId: 'trace-xyz',
				error: { code: 'VALIDATION', message: 'discount > total' },
			}),
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 999 })
		await syncOutbox.flushNow()
		const status = syncOutbox.status()
		// Item остаётся в очереди — чек не должен исчезнуть.
		expect(status.quarantined).toBe(1)
		expect(status.state).toBe('attention')
		const q = syncOutbox.quarantined()
		expect(q).toHaveLength(1)
		expect(q[0].key).toBe('sale')
		expect(q[0].id).toBe('o1')
		expect(q[0]._quarantineReason.code).toBe('VALIDATION')
		expect(q[0]._quarantineReason.status).toBe(400)
		expect(q[0]._quarantineReason.traceId).toBe('trace-xyz')
		// Полный payload сохранён — оператор может пересоздать чек вручную.
		expect(q[0].obj.items[0].qty).toBe(1)
	})

	it('карантин не ретраится автоматически на следующем flush', async () => {
		const { enqueueSale } = await import('./cloud.js')
		let calls = 0
		h.impl = {
			...makeApi(),
			apiSale: async () => {
				calls += 1
				return { ok: false, status: 400, error: { code: 'VALIDATION', message: 'bad' } }
			},
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		await syncOutbox.flushNow()
		await syncOutbox.flushNow()
		expect(calls).toBe(1) // после карантина повторных запросов нет
	})

	it('retryQuarantined снимает флаг → следующий flush отправляет снова', async () => {
		const { enqueueSale } = await import('./cloud.js')
		let attempt = 0
		h.impl = {
			...makeApi(),
			apiSale: async () => {
				attempt += 1
				// Первый раз — 400 (карантин). Второй — ok (после ручного retry).
				return attempt === 1
					? { ok: false, status: 400, error: { code: 'VALIDATION', message: 'bad' } }
					: { ok: true, body: {} }
			},
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		expect(syncOutbox.status().quarantined).toBe(1)
		syncOutbox.retryQuarantined('o1', 'sale')
		await syncOutbox.flushNow()
		expect(attempt).toBe(2)
		expect(syncOutbox.status()).toMatchObject({ pending: 0, quarantined: 0, state: 'ok' })
	})

	it('idempotency-replayed → считается успехом', async () => {
		const { enqueueSale } = await import('./cloud.js')
		h.impl = {
			...makeApi(),
			apiSale: async () => ({
				ok: false, status: 200, headers: { 'idempotency-replayed': 'true' },
				error: { code: 'REPLAY', message: 'already applied' },
			}),
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await syncOutbox.flushNow()
		expect(syncOutbox.status().pending).toBe(0)
	})

	it('sale переживает неудачную отправку и лежит в очереди с полным payload', async () => {
		const { enqueueSale, syncOutbox: box } = await import('./cloud.js')
		h.impl = {
			...makeApi(),
			apiSale: async () => { throw new Error('offline') },
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await box.flushNow()
		expect(box.status().pending).toBe(1)
		const items = box.items()
		const it = items.find((i) => i.key === 'sale' && i.id === 'o1')
		expect(it).toBeTruthy()
		expect(it.obj.items[0].qty).toBe(1) // payload сохранён для повторной отправки
	})

	it('повторный enqueueSale с другим payload отклоняется', async () => {
		const { enqueueSale } = await import('./cloud.js')
		const calls = []
		h.impl = {
			...makeApi(),
			apiSale: async (order) => { calls.push(order); return { ok: true, body: {} } },
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		expect(await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 2, price: 100 }], discount: 0 })).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
		await syncOutbox.flushNow()
		expect(calls).toHaveLength(1)
		expect(calls[0].items[0].qty).toBe(1)
	})

	it('порядок: sale уходит раньше order_status(cancelled) по тому же заказу', async () => {
		const { enqueueSale, enqueueOrderStatus } = await import('./cloud.js')
		const seq = []
		h.impl = {
			...makeApi(),
			apiSale: async () => { seq.push('sale'); return { ok: true, body: {} } },
			apiOrderStatus: async (_id, status) => { seq.push(`status:${status}`); return { ok: true, body: {} } },
		}
		await enqueueSale({ id: 'o1', items: [{ productId: 'p1', qty: 1, price: 100 }], discount: 0 })
		await enqueueOrderStatus('o1', 'cancelled')
		await syncOutbox.flushNow()
		expect(seq).toEqual(['sale', 'status:cancelled'])
	})
})

describe('return v2 transport and quarantine', () => {
  const command = () => ({ request: { contractVersion: 2, returnId: crypto.randomUUID(), orderId: 'source',
    items: [{ saleLineId: 'sale-source-0', qtyBase: '1.0000' }] },
    projection: { createdAt: '2026-10-16T00:00:00Z', estimatedTotal: 100, items: [{ productId: 'p', qtyBase: '1.0000', qty: 1 }] } })
  const success = (body) => ({ ok: true, body: { ...body, documentId: `ret-${body.returnId}`, fingerprint: 'server-fingerprint' } })
  it('uses the persisted v2 body and stable key after a lost response', async () => {
    const { enqueueReturn } = await import('./cloud')
    h.impl = makeApi()
    const calls = [], posted = new Set(), cmd = command()
    h.impl.apiReturn = async (body, key, context) => {
      calls.push({ body, key, context }); posted.add(body.returnId)
      return calls.length === 1 ? { ok: false, status: 0, error: { code: 'NETWORK' } } : success(body)
    }
    expect((await enqueueReturn(cmd)).ok).toBe(true)
    await syncOutbox.flushNow(); expect(syncOutbox.items()).toHaveLength(1)
    await syncOutbox.flushNow(); expect(syncOutbox.items()).toEqual([])
    expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]); expect(posted.size).toBe(1)
    expect(calls[0]).toMatchObject({ body: cmd.request, key: `return:${cmd.request.returnId}`, context: h.context })
  })
  it.each([409, 422])('HTTP %s retains the immutable command and stops automatic sending', async (status) => {
    const { enqueueReturn } = await import('./cloud')
    h.impl = makeApi(); const cmd = command()
    h.impl.apiReturn = vi.fn(async () => ({ ok: false, status, error: { code: status === 409 ? 'RETURN_ID_CONFLICT' : 'FINANCIAL_RECONCILIATION_REQUIRED', message: 'Review required' } }))
    await enqueueReturn(cmd); await syncOutbox.flushNow(); await syncOutbox.flushNow()
    expect(h.impl.apiReturn).toHaveBeenCalledTimes(1)
    expect(syncOutbox.items()[0]).toMatchObject({ id: cmd.request.returnId, obj: cmd, _quarantined: true, _quarantineReason: { status } })
    expect(syncOutbox.removeQuarantined(cmd.request.returnId, 'return_v2')).toBe(false)
  })
  it('does not acknowledge an ordinary refund row or malformed success response', async () => {
    const { enqueueReturn } = await import('./cloud')
    h.impl = makeApi(); h.impl.apiReturn = async () => ({ ok: true, body: { kind: 'refund', id: 'ordinary' } })
    const cmd = command(); await enqueueReturn(cmd); await syncOutbox.flushNow()
    expect(syncOutbox.quarantined()[0]._quarantineReason.code).toBe('RETURN_RESPONSE_UNVERIFIED')
  })
})


describe('invitation POST boundary',()=>{
 it('never sends an empty-body invitation acceptance',async()=>{
  h.invitationToken=null;const apiFetch=vi.fn();h.impl={apiFetch}
  expect(await acceptInvitation()).toBe(null);expect(apiFetch).not.toHaveBeenCalled()
 })
 it('uses the in-memory secret only in the authorized POST body and clears it on success',async()=>{
  h.invitationToken='a'.repeat(32);const apiFetch=vi.fn(async()=>({ok:true,body:{companyId:'c1'}}));h.impl={apiFetch}
  expect(await acceptInvitation()).toBe('c1')
  expect(apiFetch).toHaveBeenCalledWith('POST','/v1/invitations/accept',{token:'a'.repeat(32)},{skipCompany:true,context:h.context})
  expect(h.invitationToken).toBe(null)
  expect(await acceptInvitation()).toBe(null);expect(apiFetch).toHaveBeenCalledOnce()
 })
 it('keeps a failed proof only in memory for retry and shows the server reason',async()=>{
  h.invitationToken='a'.repeat(32);h.impl={apiFetch:async()=>({ok:false,error:{message:'Срок приглашения истёк'}})}
  await expect(acceptInvitation()).rejects.toThrow('Срок приглашения истёк')
  expect(h.invitationToken!==null).toBe(true);h.invitationToken=null
 })
 it('deduplicates concurrent acceptance of the same proof',async()=>{
  h.invitationToken='c'.repeat(32);h.invitationRevision++
  let resolve;const apiFetch=vi.fn(()=>new Promise(r=>{resolve=r}));h.impl={apiFetch}
  const first=acceptInvitation(),second=acceptInvitation();expect(first).toBe(second)
  await vi.waitFor(()=>expect(apiFetch).toHaveBeenCalledOnce());resolve({ok:true,body:{companyId:'c1'}})
  expect(await first).toBe('c1');expect(await second).toBe('c1')
 })
 it('serializes distinct proofs and ignores the late response of an older invitation',async()=>{
  h.invitationToken='d'.repeat(32);h.invitationRevision++
  let resolve;const apiFetch=vi.fn(()=>new Promise(r=>{resolve=r}));h.impl={apiFetch}
  const old=acceptInvitation();await vi.waitFor(()=>expect(apiFetch).toHaveBeenCalledOnce())
  h.invitationToken='e'.repeat(32);h.invitationRevision++;const next=acceptInvitation()
  apiFetch.mockImplementationOnce(async()=>({ok:true,body:{companyId:'next'}}))
  resolve({ok:true,body:{companyId:'old'}});expect(await old).toBe(null)
  expect(await next).toBe('next');expect(apiFetch.mock.calls[1][2].token).toBe('e'.repeat(32))
 })
 it('does not restore proof or select a company after logout/context change',async()=>{
  h.invitationToken='f'.repeat(32);h.invitationRevision++
  let resolve;const apiFetch=vi.fn(()=>new Promise(r=>{resolve=r}));h.impl={apiFetch}
  const pending=acceptInvitation();await vi.waitFor(()=>expect(apiFetch).toHaveBeenCalledOnce())
  h.invitationToken=null;h.context={...h.context,generation:h.context.generation+1}
  resolve({ok:true,body:{companyId:'old'}});expect(await pending).toBe(null);expect(h.invitationToken).toBe(null)
 })

})
