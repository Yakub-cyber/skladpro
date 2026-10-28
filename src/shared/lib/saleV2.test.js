import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { createDocumentsSlice } from '../store/slices/documentsSlice'
import { createOutbox, safeStorage, canonicalPayload } from './outbox'
import { createScopedCache } from './scopedCache'
import { warehouseCommandRequest } from './stockProjection'
import { commandResources } from './outboxDependencies'
import { verifySaleResponse } from './saleV2'

const h = vi.hoisted(() => ({ ctx: { userId: 'u', companyId: 'a', generation: 1 }, cache: null, box: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.ctx }), isAuthContextCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }))
vi.mock('./cloud', () => ({ enqueueSale: (obj, sourceDocumentId) => h.box.enqueueCommand({ ...h.ctx, op: 'create', key: 'sale', id: obj.order.id, idempotencyKey: `sale-${obj.order.id}`, ...(sourceDocumentId ? { sourceDocumentId } : {}), obj }), enqueueReturn: vi.fn(), enqueueOrderStatus: vi.fn(), enqueueDocument: vi.fn() }))
vi.mock('./scopedCache', async original => ({ ...await original(), companyCache: { overlayLocal: (ctx, state) => h.cache.overlayLocal(ctx, state), error: () => h.cache.error() } }))
let storage, locks, store, boxes
const input = (warehouseId = 'A') => ({ warehouseId, items: [{ productId: 'p', name: 'Product', qty: 2, price: 50 }], total: 100 })
const makeBox = (send = async batch => ({ sent: batch })) => {
  const b = createOutbox({ storage, locks, context: h.ctx, send, yieldControl: async () => {}, debounceMs: 60000, baseDelayMs: 60000 }); boxes.push(b); return b
}
function saveSnapshot(ops = [], resolution = 'not_observed', a = 40) {
  const request = { contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands: ops.map(warehouseCommandRequest) }
  h.cache.saveWarehouseSnapshot(h.ctx, request, { contractVersion: 1, companyId: h.ctx.companyId, requestId: request.requestId, snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot',
    coverage: { productIds: ['p'], warehouseScope: 'all-company-warehouses', complete: true, missingBalanceMeansZero: true },
    warehouses: [{ id: 'A', active: true }, { id: 'B', active: true }], balances: [{ productId: 'p', warehouseId: 'A', qtyBase: String(a) }, { productId: 'p', warehouseId: 'B', qtyBase: '60' }], totals: [{ productId: 'p', qtyBase: String(a + 60) }],
    commands: ops.map(op => ({ commandId: op.id, resolution, effectIncluded: resolution === 'applied' ? true : resolution === 'not_observed' ? false : null, documentId: resolution === 'applied' ? `sale-${op.id}` : null, reason: 'TEST' })) })
}
beforeEach(() => {
  vi.stubGlobal('sessionStorage', safeStorage()); h.ctx = { userId: 'u', companyId: 'a', generation: 1 }; boxes = []; storage = safeStorage()
  const tails = new Map(); locks = { request: (key, run) => { const p = (tails.get(key) || Promise.resolve()).then(run); tails.set(key, p.catch(() => {})); return p } }
  h.cache = createScopedCache({ storage, getContext: () => h.ctx, isCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }); h.cache.activate(h.ctx); h.box = makeBox()
  store = { cloud: true, products: [{ id: 'p', stock: 100 }], warehouses: [{ id: 'A' }, { id: 'B' }, { id: 'old', active: false }], orders: [], documents: [], accounts: [], customers: [], shifts: [], moneyTx: [], audit: [], logAction: vi.fn() }
  const get = () => store, set = patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) } }
  store = { ...store, ...createOrdersSlice(set, get), ...createDocumentsSlice(set, get) }; saveSnapshot()
})
afterEach(() => { boxes.forEach(b => b.destroy()); vi.unstubAllGlobals() })
describe('sale v2 durable frontend integration', () => {
  it.each(['A', 'B'])('keeps the full immutable envelope and projects only warehouse %s', async warehouseId => {
    expect((await store.createSaleDocument(input(warehouseId))).ok).toBe(true)
    const op = h.box.items()[0]
    expect(op.obj).toMatchObject({ contractVersion: 2, order: { id: op.id, warehouseId, items: [{ productId: 'p', qty: 2, price: 50 }] } })
    expect(warehouseCommandRequest(op).payload).toEqual(op.obj)
    expect(commandResources(op)).toMatchObject({ products: ['p'], warehouses: [warehouseId], scope: 'warehouse_product' })
    const projected = h.cache.warehouseProjection(h.ctx).get('p')
    expect(projected.total).toBe(98); expect(projected.warehouses[warehouseId].projected).toBe(warehouseId === 'A' ? 38 : 58)
    expect(h.cache.readWarehouseSnapshot().totals[0].qtyBase).toBe('100')
  })
  it.each(['', 'old', 'foreign'])('rejects absent/archived/foreign warehouse %s before durable acceptance', async warehouseId => {
    expect((await store.createSaleDocument(input(warehouseId))).ok).toBe(false); expect(h.box.items()).toEqual([]); expect(store.orders).toEqual([])
  })
  it('reloads the exact envelope and snapshot, then skips applied without double deduction', async () => {
    await store.createSaleDocument(input()); const op = h.box.items()[0], raw = JSON.stringify(op.obj)
    h.box = makeBox(); expect(JSON.stringify(h.box.items()[0].obj)).toBe(raw)
    h.cache = createScopedCache({ storage, getContext: () => h.ctx, isCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }); h.cache.activate(h.ctx)
    expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
    saveSnapshot([op], 'applied', 38)
    expect(h.cache.warehouseProjection(h.ctx).get('p')).toMatchObject({ total: 98, confirmedTotal: 98 })
    expect(h.box.items()).toHaveLength(1) // reconciliation is not an outbox acknowledgement
  })
  it.each(['conflict', 'unverifiable'])('withholds precise forecast for %s without removing the command', async resolution => {
    await store.createSaleDocument(input()); saveSnapshot(h.box.items(), resolution, 38)
    expect(h.cache.warehouseProjection(h.ctx).get('p')).toMatchObject({ available: false, total: null })
    expect(h.box.items()).toHaveLength(1)
  })
  it('projects not_observed against this snapshot only and withholds quarantined STALE', async () => {
    await store.createSaleDocument(input()); const op = h.box.items()[0]; saveSnapshot([op])
    expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
    storage.setItem(`sklad.outbox.v2.u:a.meta.${op._entryId}`, JSON.stringify({ _quarantined: true, _quarantineReason: { code: 'STALE' } }))
    expect(h.cache.warehouseProjection(h.ctx).get('p').available).toBe(false)
  })
  it('two tabs reject changed payload and idempotency key and preserve the accepted identity', async () => {
    await store.createSaleDocument(input()); const op = h.box.items()[0], peer = makeBox()
    expect(await peer.enqueueCommand(op)).toMatchObject({ ok: true, duplicate: true })
    expect(await peer.enqueueCommand({ ...op, idempotencyKey: 'changed-key' })).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    expect(await peer.enqueueCommand({ ...op, obj: { ...op.obj, order: { ...op.obj.order, warehouseId: 'B' } } })).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    expect(peer.items()[0].obj).toEqual(op.obj)
  })
  it('retains the payload after lost response and retries it under the same key', async () => {
    const requests = []; let lose = true
    h.box = makeBox(async batch => { requests.push({ key: batch[0].idempotencyKey, obj: batch[0].obj }); if (lose) { lose = false; throw Error('response lost') } return { sent: batch } })
    await store.createSaleDocument(input()); await h.box.flushNow(); expect(h.box.items()).toHaveLength(1)
    await h.box.flushNow(); expect(requests[0]).toEqual(requests[1]); expect(h.box.items()).toHaveLength(0)
  })
  it('keeps company ownership and dependency barrier after reload', async () => {
    await store.createSaleDocument(input()); const first = h.box.items()[0]
    storage.setItem(`sklad.outbox.v2.u:a.meta.${first._entryId}`, JSON.stringify({ _quarantined: true, _quarantineReason: { code: 'STALE' } }))
    await store.createSaleDocument(input()); const send = vi.fn(async batch => ({ sent: batch })), peer = makeBox(send)
    await peer.flushNow(); expect(send).not.toHaveBeenCalled()
    const other = { ...h.ctx, companyId: 'b' }; peer.setContext(other)
    expect(peer.items()).toEqual([]); expect(h.cache.warehouseProjection(other).size).toBe(0)
  })
  it('does not trust a warehouse on legacy commands or infer one for old drafts', async () => {
    expect(commandResources({ key: 'sale', obj: { id: 'legacy', warehouseId: 'A', items: input().items } }).warehouses).toEqual([])
    store.documents.push({ id: 'draft', status: 'draft', type: 'sale', payMethod: 'cash', items: input().items, total: 100 })
    expect((await store.postDocument('draft')).ok).toBe(false); expect(h.box.items()).toEqual([])
  })
  it('draft posting and immediate document sale both use the durable sale engine', async () => {
    const id = store.addDocument({ type: 'sale', warehouseId: 'B', payMethod: 'cash', items: input().items, total: 100 }, { post: false })
    expect((await store.postDocument(id)).ok).toBe(true)
    expect(h.box.items()[0].obj.order.warehouseId).toBe('B')
    expect(store.documents.find(d => d.id === id)).toBeUndefined()
    expect((await store.addDocument({ type: 'sale', warehouseId: 'A', payMethod: 'cash', items: input().items, total: 100 })).ok).toBe(true)
    expect(h.box.items()).toHaveLength(2)
  })
  it('verifies the permanent response fingerprint and all sale line identities', async () => {
    await store.createSaleDocument(input()); const payload = h.box.items()[0].obj, order = payload.order
    const body = { ok: true, contractVersion: 2, order: { id: order.id }, warehouseId: 'A', documentId: `sale-${order.id}`,
      fingerprint: createHash('sha256').update(canonicalPayload({ contractVersion: 2, companyId: 'a', order })).digest('hex'), items: [{ saleLineId: `sale-${order.id}-0`, productId: 'p', qtyBase: '2.0000' }] }
    expect(await verifySaleResponse(payload, body, 'a')).toBe(true)
    expect(await verifySaleResponse(payload, { ...body, fingerprint: 'wrong' }, 'a')).toBe(false)
    expect(await verifySaleResponse(payload, body, 'b')).toBe(false)
  })
  it('durable source metadata prevents draft resurrection and a stale tab cannot create a second sale', async () => {
    const id = store.addDocument({ type: 'sale', warehouseId: 'A', payMethod: 'cash', items: input().items, total: 100 }, { post: false })
    const draft = store.documents.find(d => d.id === id)
    h.cache.setItem('sklad.db', JSON.stringify({ version: 19, state: { ...store, authAccountId: 'u', companyId: 'a' } }))
    expect((await store.postDocument(id)).ok).toBe(true)
    const op = h.box.items()[0]; expect(op.sourceDocumentId).toBe(id)
    expect(h.cache.read(h.ctx).state.documents.find(d => d.id === id)).toBeUndefined()
    store.documents.push(draft) // stale tab's original draft snapshot
    await store.postDocument(id)
    expect(h.box.items()).toHaveLength(1)
    expect(h.box.items()[0].id).toBe(op.id)
  })
})
