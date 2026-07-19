import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Мок API-клиента ────────────────────────────────────────────────────────
// h.impl подменяется в каждом тесте; log копит вызовы в порядке исполнения.
const h = vi.hoisted(() => ({ impl: null }))

vi.mock('./api', () => ({
	hasApi: true,
	getSession: () => null,
	getCompanyId: () => 'c1',
	onAuthChange: () => () => {},
	apiSignIn: () => Promise.resolve({ ok: true }),
	apiSignUp: () => Promise.resolve({ ok: true }),
	apiSignOut: () => Promise.resolve(),
	apiListMemberships: () => Promise.resolve({ ok: true, body: { memberships: [] } }),
	apiCreateCompany: () => Promise.resolve({ ok: true, body: {} }),
	apiPinVerify: () => Promise.resolve({ ok: false, error: { code: 'PIN_INVALID' } }),
	apiSale: () => Promise.resolve({ ok: true, body: {} }),
	apiDocument: () => Promise.resolve({ ok: true, body: {} }),
	apiReturn: () => Promise.resolve({ ok: true, body: {} }),
	apiFetch: (...args) => h.impl.apiFetch(...args),
	apiSyncPull: (...args) => h.impl.apiSyncPull(...args),
	apiSyncPush: (...args) => h.impl.apiSyncPush(...args),
	apiPutSettings: (...args) => h.impl.apiPutSettings(...args),
}))

import { cloudLoadMerged, applyPendingToData, syncOutbox } from './cloud'

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
	companyId: 'c1',
})

beforeEach(() => syncOutbox.reset())
afterEach(() => syncOutbox.reset())

describe('cloudLoadMerged — порядок bootstrap', () => {
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
			{ op: 'delete', key: 'products', id: 'p3', companyId: 'c1' },
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
	it('терминальная ошибка per-op (STALE/TABLE_FORBIDDEN) → элемент выброшен, без ретраев', async () => {
		h.impl = makeApi({ pushResults: () => [{ ok: false, code: 'STALE', error: 'server newer' }] })
		syncOutbox.enqueue([up('p1')])
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 0, state: 'ok' })
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
			{ op: 'upsert', key: 'settings', id: 'c1', obj: { company: 'X' }, companyId: 'c1' },
		])
		await syncOutbox.flushNow()
		const call = h.impl.log.find(([op]) => op === 'settings')
		expect(call).toBeTruthy()
		expect(call[1]).toEqual({ company: 'X' }) // ровно data, без обёртки
	})

	it('удаления уезжают отдельными op-ами в один push-батч', async () => {
		h.impl = makeApi()
		syncOutbox.enqueue([
			{ op: 'delete', key: 'products', id: 'p1', companyId: 'c1' },
			{ op: 'delete', key: 'products', id: 'p2', companyId: 'c1' },
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
			{ op: 'upsert', key: 'movements', id: 'm1', obj: { id: 'm1' }, companyId: 'c1' },
			{ op: 'upsert', key: 'audit', id: 'a1', obj: { id: 'a1' }, companyId: 'c1' },
		])
		await syncOutbox.flushNow()
		expect(syncOutbox.status()).toMatchObject({ pending: 0, state: 'ok' })
		// Ничего не улетело push'ем — оба элемента объявлены terminal-dropped.
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
				companyId: 'c1',
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
			{ op: 'delete', key: 'products', id: 'p2', companyId: 'c1' },
			{ op: 'upsert', key: 'settings', id: 'c1', obj: { currency: '₽' }, companyId: 'c1' },
			{ op: 'upsert', key: 'нет_такой', id: 'x', obj: {}, companyId: 'c1' }, // не падает
		])
		expect(data.products.map((p) => p.id).sort()).toEqual(['p1', 'p9'])
		expect(data.products.find((p) => p.id === 'p1').stock).toBe(100)
		expect(data.settings).toEqual({ company: 'Сервер', currency: '₽' })
	})

	it('сравнение по updatedAt: свежий сервер побеждает устаревший локальный', () => {
		const data = { products: [{ id: 'p1', stock: 200, updatedAt: '2026-07-13T12:00:00Z' }] }
		applyPendingToData(data, [up('p1', { stock: 5, updatedAt: '2026-07-13T10:00:00Z' })])
		expect(data.products[0].stock).toBe(200)
	})

	it('сравнение по updatedAt: свежий локальный побеждает устаревший сервер', () => {
		const data = { products: [{ id: 'p1', stock: 200, updatedAt: '2026-07-13T10:00:00Z' }] }
		applyPendingToData(data, [up('p1', { stock: 5, updatedAt: '2026-07-13T12:00:00Z' })])
		expect(data.products[0].stock).toBe(5)
	})

	it('без updatedAt (миграция не применена) — сохраняется прежнее поведение', () => {
		const data = { products: [{ id: 'p1', stock: 200 }] }
		applyPendingToData(data, [up('p1', { stock: 5 })])
		expect(data.products[0].stock).toBe(5)
	})

	it('delete всегда применяется, даже если серверная запись свежее', () => {
		const data = { products: [{ id: 'p1', updatedAt: '2026-07-13T12:00:00Z' }] }
		applyPendingToData(data, [{ op: 'delete', key: 'products', id: 'p1', companyId: 'c1' }])
		expect(data.products).toHaveLength(0)
	})
})

describe('attachSync штампует updatedAt при отправке', () => {
	it('upsert в очередь получает updatedAt (ISO), settings — не получает', async () => {
		const { attachSync } = await import('./cloud.js')
		const listeners = new Set()
		let state = {
			companyId: 'c1',
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
