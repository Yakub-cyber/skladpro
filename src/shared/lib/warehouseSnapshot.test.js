import { describe, it, expect } from 'vitest'
import { createWarehouseReconciler, validateWarehouseSnapshot, validateStockRequest } from './warehouseSnapshot'
import { createScopedCache } from './scopedCache'
import { safeStorage } from './outbox'

const A = { userId: 'u', companyId: 'a', generation: 1 }
const B = { userId: 'u', companyId: 'b', generation: 2 }
const uuid = () => crypto.randomUUID()
const request = (commands = []) => ({ contractVersion: 1, requestId: uuid(), productIds: ['p'], commands })
const command = (n) => ({ commandId: 'c' + n, kind: 'doc_post', idempotencyKey: 'doc-c' + n, payload: { id: 'c' + n } })
function response(req, extra = {}) {
  return { contractVersion: 1, companyId: 'a', requestId: req.requestId, snapshotId: uuid(), consistency: 'transaction-snapshot',
    coverage: { productIds: ['p'], warehouseScope: 'all-company-warehouses', complete: true, missingBalanceMeansZero: true },
    warehouses: [{ id: 'w1', active: true }, { id: 'w2', active: false }],
    balances: [{ warehouseId: 'w1', productId: 'p', qtyBase: '40.0000' }, { warehouseId: 'w2', productId: 'p', qtyBase: '60.0000' }],
    totals: [{ productId: 'p', qtyBase: '100.0000' }], commands: req.commands.map((c) => ({ commandId: c.commandId, resolution: 'unverifiable', effectIncluded: null, documentId: null, reason: 'NO_PROOF' })), ...extra }
}
function fixture(storage = safeStorage()) {
  let context = A
  const getContext = () => context
  const isCurrent = (c) => c.userId === context.userId && c.companyId === context.companyId && c.generation === context.generation
  const cache = createScopedCache({ storage, getContext, isCurrent })
  cache.activate(A)
  return { storage, cache, getContext, isCurrent, select: (c) => { context = c; cache.activate(c) },
    manager: (fetchSnapshot) => createWarehouseReconciler({ fetchSnapshot, cache, getContext, isCurrent }) }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const stored = (f) => f.cache.readWarehouseSnapshot(A)

describe('warehouse reconciliation: validation and atomic scoped persistence', () => {
  it('persists both warehouses, including archived stock, without changing legacy cache or outbox', async () => {
    const f = fixture(), req = request()
    f.storage.setItem('sklad.db.v3.u:a.server', JSON.stringify({ userId: 'u', companyId: 'a', state: { products: [{ id: 'p', stock: 0 }] } }))
    f.storage.setItem('sklad.outbox.v2.u:a.op.x', JSON.stringify({ userId: 'u', companyId: 'a', key: 'products', id: 'p', obj: { original: 'unchanged' }, _entryId: 'x', _order: 1 }))
    const before = [f.storage.getItem('sklad.db.v3.u:a.server'), f.storage.getItem('sklad.outbox.v2.u:a.op.x')]
    const manager = f.manager(async (r) => ({ ok: true, body: response(r) }))
    const snapshot = await manager({ productIds: req.productIds })
    expect(stored(f)).toEqual(snapshot)
    expect(snapshot.warehouses[1].active).toBe(false)
    expect([f.storage.getItem('sklad.db.v3.u:a.server'), f.storage.getItem('sklad.outbox.v2.u:a.op.x')]).toEqual(before)
  })
  it('accepts missing rows only with full coverage and matching zero totals', () => {
    const req = request(), value = response(req, { balances: [], totals: [{ productId: 'p', qtyBase: '0' }] })
    expect(validateWarehouseSnapshot(value, req, 'a').balances).toEqual([])
    for (const field of ['complete', 'missingBalanceMeansZero']) {
      expect(() => validateWarehouseSnapshot({ ...value, coverage: { ...value.coverage, [field]: false } }, req, 'a')).toThrow()
    }
    expect(() => validateWarehouseSnapshot({ ...value, totals: [{ productId: 'p', qtyBase: '100' }] }, req, 'a')).toThrow()
  })
  it('validates exact coverage, warehouse references, totals and command membership', () => {
    const req = request([command(1)]), good = response(req)
    const cases = [
      { contractVersion: 2 }, { companyId: 'b' }, { requestId: uuid() }, { consistency: 'eventual' },
      { coverage: { ...good.coverage, productIds: ['p', 'other'] } },
      { balances: [...good.balances, good.balances[0]] }, { warehouses: [good.warehouses[0]] },
      { totals: [] }, { totals: [{ productId: 'p', qtyBase: 100 }] }, { commands: [] },
      { commands: [...good.commands, good.commands[0]] },
      { commands: [{ ...good.commands[0], resolution: 'unknown' }] },
      { commands: [{ ...good.commands[0], resolution: 'conflict', effectIncluded: true }] },
    ]
    for (const changes of cases) expect(() => validateWarehouseSnapshot({ ...good, ...changes }, req, 'a')).toThrow()
  })
  it('stores all five resolutions without acknowledging or changing the commands', async () => {
    const f = fixture(), commands = Array.from({ length: 5 }, (_, n) => command(n)), before = JSON.stringify(commands)
    const statuses = [['applied', true], ['not_observed', false], ['reversed', false], ['conflict', null], ['unverifiable', null]]
    const manager = f.manager(async (req) => ({ ok: true, body: response(req, { commands: req.commands.map((c, n) => ({ commandId: c.commandId, resolution: statuses[n][0], effectIncluded: statuses[n][1], documentId: 'd' + n, reason: 'PROOF' })) }) }))
    expect((await manager({ productIds: ['p'], commands })).commands.map((c) => c.resolution)).toEqual(statuses.map(([s]) => s))
    expect(JSON.stringify(commands)).toBe(before)
    expect(Array.from({ length: f.storage.length }, (_, n) => f.storage.key(n)).some((k) => k.includes('outbox'))).toBe(false)
  })
  it.each([B, { userId: null, companyId: null, generation: 2 }, { userId: 'other', companyId: 'a', generation: 2 }])('rejects a late response after company/logout/user change: %j', async (next) => {
    const f = fixture(), wait = deferred(); let req
    const manager = f.manager((r) => { req = r; return wait.promise })
    const pending = manager({ productIds: ['p'] })
    f.select(next); wait.resolve({ ok: true, body: response(req) })
    await expect(pending).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' })
    f.select(A); expect(stored(f)).toBe(null)
  })
  it('does not let an older request completing later overwrite a newer accepted snapshot', async () => {
    const f = fixture(), calls = []
    const manager = f.manager((req) => { const wait = deferred(); calls.push({ req, wait }); return wait.promise })
    const first = manager({ productIds: ['p'] }), second = manager({ productIds: ['p'] })
    const newest = response(calls[1].req)
    calls[1].wait.resolve({ ok: true, body: newest }); await second
    calls[0].wait.resolve({ ok: true, body: response(calls[0].req) })
    await expect(first).rejects.toMatchObject({ code: 'STOCK_REQUEST_SUPERSEDED' })
    expect(stored(f)).toEqual(newest)
  })
  it('reads a complete snapshot after offline reload and keeps user/company isolation', async () => {
    const f = fixture(), req = request(), value = response(req)
    f.cache.saveWarehouseSnapshot(A, req, value)
    const reload = fixture(f.storage)
    expect(stored(reload)).toEqual(value)
    reload.select(B); expect(reload.cache.readWarehouseSnapshot(B)).toBe(null)
    reload.select({ userId: 'other', companyId: 'a', generation: 3 })
    expect(reload.cache.readWarehouseSnapshot()).toBe(null)
  })
  it('reports quota failure and preserves the last complete snapshot', async () => {
    const f = fixture(), req = request(), old = response(req)
    f.cache.saveWarehouseSnapshot(A, req, old)
    const set = f.storage.setItem.bind(f.storage)
    f.storage.setItem = () => { throw new Error('QuotaExceededError') }
    await expect(f.manager(async (r) => ({ ok: true, body: response(r) }))({ productIds: ['p'] })).rejects.toThrow('QuotaExceededError')
    expect(f.cache.error()).toBe('QuotaExceededError')
    expect(stored(f)).toEqual(old)
    f.storage.setItem = set
  })
  it('rejects corrupt or foreign cached records without deleting them or importing old stock', () => {
    const f = fixture(), key = 'sklad.db.v3.u:a.warehouseSnapshot.v1'
    f.storage.setItem('sklad.db.v3.u:a.stock.old', JSON.stringify({ products: [{ id: 'p', stock: 90 }] }))
    expect(stored(f)).toBe(null)
    for (const raw of ['broken', JSON.stringify({ version: 1, userId: 'other', companyId: 'a' })]) {
      f.storage.setItem(key, raw)
      expect(() => stored(f)).toThrow()
      expect(f.storage.getItem(key)).toBe(raw)
    }
    const req = request()
    f.cache.saveWarehouseSnapshot(A, req, response(req))
    const record = JSON.parse(f.storage.getItem(key))
    record.snapshot.totals[0].qtyBase = '999'
    f.storage.setItem(key, JSON.stringify(record))
    expect(() => stored(f)).toThrow('STOCK_SNAPSHOT_INVALID')
  })
  it('does not present volatile fallback storage as a durable offline snapshot', () => {
    const f = fixture(), req = request()
    f.storage.volatile = true
    expect(() => f.cache.saveWarehouseSnapshot(A, req, response(req))).toThrow('только в памяти')
    expect(() => stored(f)).toThrow('не сохранён надёжно')
  })
  it('retains old cache when the network fails, the server times out or the response is partial', async () => {
    const f = fixture(), req = request(), old = response(req)
    f.cache.saveWarehouseSnapshot(A, req, old)
    const transports = [async () => { throw new Error('offline') }, async () => ({ ok: false, error: { code: 'STOCK_RECONCILE_TIMEOUT' } }), async (r) => ({ ok: true, body: response(r, { totals: [] }) })]
    for (const fetch of transports) {
      await expect(f.manager(fetch)({ productIds: ['p'] })).rejects.toThrow()
      expect(stored(f)).toEqual(old)
    }
  })
  it('enforces request and response limits without splitting requests', async () => {
    const req = request()
    expect(() => validateStockRequest({ ...req, productIds: Array.from({ length: 501 }, (_, n) => 'p' + n) })).toThrow()
    expect(() => validateStockRequest({ ...req, commands: Array.from({ length: 501 }, (_, n) => command(n)) })).toThrow()
    expect(() => validateStockRequest({ ...req, commands: [{ ...command(1), payload: { text: 'x'.repeat(262144) } }] })).toThrow()
    expect(() => validateWarehouseSnapshot(response(req, { warehouses: Array.from({ length: 20001 }, (_, n) => ({ id: 'w' + n, active: true })) }), req, 'a')).toThrow()
    expect(() => validateWarehouseSnapshot(response(req, { extra: 'x'.repeat(4 * 1024 * 1024) }), req, 'a')).toThrow()
  })
})
