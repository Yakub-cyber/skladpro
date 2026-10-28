import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { createOutbox, safeStorage, canonicalPayload } from './outbox'
import { createScopedCache, emptyCloudData } from './scopedCache'
import { commandResources } from './outboxDependencies'
import { prepareCommercial, verifyCommercialResponse } from './commercialOrders'

const h = vi.hoisted(() => ({ ctx: { userId: 'u', companyId: 'a', generation: 1 }, cache: null, box: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.ctx }), isAuthContextCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }))
vi.mock('./cloud', () => ({ enqueueSale: vi.fn(), enqueueReturn: vi.fn(), enqueueOrderStatus: vi.fn(),
  enqueueCommercialOrder: (key, obj) => h.box.enqueueCommand({ ...h.ctx, op: key === 'commercial_create' ? 'create' : 'update', key, id: obj.commandId, idempotencyKey: `commercial:${obj.commandId}`, obj }) }))
vi.mock('./scopedCache', async original => ({ ...await original(), companyCache: {
  overlayLocal: (ctx, state) => h.cache.overlayLocal(ctx, state), error: () => h.cache.error(), commercialOrder: (ctx, id) => h.cache.commercialOrder(ctx, id),
} }))
let storage, locks, store, boxes
const input = () => ({ items: [{ productId: 'p', name: 'Product', qty: 2, price: 50 }], total: 100, customerId: 'c', customerName: 'Customer', discount: 0 })
const makeBox = (send = async () => ({ sent: [] })) => {
  const b = createOutbox({ storage, locks, context: h.ctx, send, yieldControl: async () => {}, debounceMs: 60000, baseDelayMs: 60000 }); boxes.push(b); return b
}
const reload = () => {
  h.cache = createScopedCache({ storage, getContext: () => h.ctx, isCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }); h.cache.activate(h.ctx)
  store.orders = h.cache.overlayLocal(h.ctx, emptyCloudData()).orders
}
function confirm(op, version = '20', snapshot = op.obj.commercial) {
  h.cache.saveCommercialOrder(h.ctx, { id: op.obj.orderId, rowVersion: version, commercialSnapshot: snapshot, status: 'new' })
  storage.setItem(`sklad.outbox.v2.u:a.ack.${op._entryId}`, 'confirmed')
  store.orders = h.cache.overlayLocal(h.ctx, store).orders
}
beforeEach(() => {
  vi.stubGlobal('sessionStorage', safeStorage()); h.ctx = { userId: 'u', companyId: 'a', generation: 1 }; boxes = []; storage = safeStorage()
  const tails = new Map(); locks = { request: (key, run) => { const p = (tails.get(key) || Promise.resolve()).then(run); tails.set(key, p.catch(() => {})); return p } }
  store = { ...emptyCloudData(), cloud: true, products: [{ id: 'p', name: 'Product', unit: 'шт', stock: 100, serverUnits: [{ id: 'unit', name: 'шт', factor: '1', isBase: true }] }], customers: [{ id: 'c', balance: 50 }], logAction: vi.fn() }
  const get = () => store, set = patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) } }
  store = { ...store, ...createOrdersSlice(set, get) }; reload(); h.box = makeBox()
})
afterEach(() => { boxes.forEach(b => b.destroy()); vi.unstubAllGlobals() })

describe('commercial orders v2 durable frontend', () => {
  it('accepts an offline creation only after the full command is durable, without money, debt or stock changes', async () => {
    const before = JSON.stringify([store.products, store.customers, store.moneyTx, store.movements])
    const result = await store.addOrder({ ...input(), onCredit: true })
    expect(result).toMatchObject({ ok: true, pending: true })
    const op = h.box.items()[0]
    expect(op.obj).toMatchObject({ contractVersion: 2, orderId: result.id, commandId: op.id, commercial: { payment: { method: 'credit', cashPaid: '0' }, items: [{ lineId: expect.any(String), unitId: 'unit', qtyBase: '2.0000' }] } })
    expect(commandResources(op)).toMatchObject({ stock: false, orderId: result.id })
    expect(JSON.stringify([store.products, store.customers, store.moneyTx, store.movements])).toBe(before)
    const payload = JSON.stringify(op.obj); reload(); h.box = makeBox()
    expect(store.orders[0]).toMatchObject({ id: result.id, commercialPending: { commandId: op.id } })
    expect(JSON.stringify(h.box.items()[0].obj)).toBe(payload)
    expect((await store.updateOrder(result.id, input(), {})).ok).toBe(false)
  })
  it('edits a trusted version offline and preserves stable line identities across reload', async () => {
    await store.addOrder(input()); const create = h.box.items()[0]; confirm(create)
    const base = structuredClone(store.orders[0].commercialSnapshot)
    const result = await store.updateOrder(create.obj.orderId, { ...input(), items: [{ ...store.orders[0].items[0], qty: 3 }] }, { expectedRowVersion: '20', baseSnapshot: base })
    expect(result.ok).toBe(true)
    const edit = h.box.items()[0]
    expect(edit.obj).toMatchObject({ expectedRowVersion: '20', commercial: { items: [{ lineId: base.items[0].lineId, qtyBase: '3.0000' }], total: '150.00' } })
    reload(); expect(store.orders[0].items[0].qty).toBe(3); expect(store.customers[0].balance).toBe(50)
    expect((await store.updateOrder(create.obj.orderId, input(), { expectedRowVersion: '20', baseSnapshot: base })).ok).toBe(false)
  })
  it('cannot resurrect an old composition through a stale server cache or old replay', async () => {
    await store.addOrder(input()); const op = h.box.items()[0]; confirm(op)
    const newer = { ...op.obj.commercial, items: op.obj.commercial.items.map(l => ({ ...l, qtyBase: '3.0000', qtyInput: '3.0000' })), subtotal: '150.00', total: '150.00' }
    h.cache.saveCommercialOrder(h.ctx, { id: op.obj.orderId, rowVersion: '30', commercialSnapshot: newer, status: 'new' })
    confirm(op, '20'); reload()
    expect(store.orders[0].commercialRowVersion).toBe('30'); expect(store.orders[0].total).toBe(150)
  })
  it('storage refusal leaves no successful preview and retries the same identity after reload', async () => {
    const write = storage.setItem.bind(storage); let reject = true
    storage.setItem = (key, value) => { if (reject && key.includes('.op.')) throw Error('quota'); write(key, value) }
    const failed = await store.addOrder(input()); expect(failed.ok).toBe(false); expect(store.orders).toHaveLength(0)
    const reservation = sessionStorage.getItem(sessionStorage.key(0)); reload(); reject = false
    const retried = await store.addOrder(input()); expect(retried.id).toBe(failed.id)
    expect(h.box.items()[0].obj).toEqual(JSON.parse(reservation).prepared.payload)
  })
  it('retains the exact command after a lost response and serializes two tabs under Web Locks', async () => {
    const calls = []; let lost = true
    h.box = makeBox(async batch => { calls.push(batch.map(op => [op.idempotencyKey, op.obj])); if (lost) { lost = false; throw Error('lost response after commit') } return { sent: batch } })
    await store.addOrder(input()); await h.box.flushNow(); const op = h.box.items()[0]
    const peer = makeBox(); expect(await peer.enqueueCommand(op)).toMatchObject({ ok: true, duplicate: true })
    expect(await peer.enqueueCommand({ ...op, obj: { ...op.obj, commercial: { ...op.obj.commercial, total: '0' } } })).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    await h.box.flushNow(); expect(calls[0]).toEqual(calls[1]); expect(h.box.items()).toHaveLength(0)
  })
  it('keeps a version-conflicted command and does not project its composition onto a newer version', async () => {
    await store.addOrder(input()); const create = h.box.items()[0]; confirm(create)
    const options = { expectedRowVersion: '20', baseSnapshot: structuredClone(store.orders[0].commercialSnapshot) }
    await store.updateOrder(create.obj.orderId, { ...input(), items: [{ ...store.orders[0].items[0], qty: 3 }] }, options)
    h.cache.saveCommercialOrder(h.ctx, { id: create.obj.orderId, rowVersion: '30', commercialSnapshot: create.obj.commercial, status: 'new' })
    reload(); expect(store.orders[0]).toMatchObject({ total: 100, commercialPending: { conflict: true } }); expect(h.box.items()).toHaveLength(1)
  })
  it('quarantine prevents same-order edits from crossing the durable barrier after reload', async () => {
    await store.addOrder(input()); const op = h.box.items()[0]
    storage.setItem(`sklad.outbox.v2.u:a.meta.${op._entryId}`, JSON.stringify({ _quarantined: true, _quarantineReason: { code: 'HTTP_422', message: 'unsupported' } }))
    await h.box.enqueueCommand({ ...h.ctx, key: 'commercial_edit', op: 'update', id: 'later', idempotencyKey: 'later', obj: { ...op.obj, commandId: 'later', expectedRowVersion: '20' } })
    const send = vi.fn(async batch => ({ sent: batch })); const peer = makeBox(send); await peer.flushNow()
    expect(send).not.toHaveBeenCalled(); reload(); expect(store.orders[0].commercialPending.conflict).toBe(true)
  })
  it('isolates companies and rejects an old-context authority after logout', async () => {
    await store.addOrder(input()); const old = { ...h.ctx }, op = h.box.items()[0]
    h.ctx = { ...h.ctx, companyId: 'b', generation: 2 }; h.box.setContext(h.ctx); reload()
    expect(store.orders).toHaveLength(0); expect(h.box.items()).toHaveLength(0)
    h.ctx = { userId: null, companyId: null, generation: 3 }
    expect(() => h.cache.saveCommercialOrder(old, { id: op.obj.orderId, rowVersion: '20', commercialSnapshot: op.obj.commercial })).toThrow('CONTEXT_CHANGED')
    h.ctx = old; h.box.setContext(old); reload(); expect(store.orders).toHaveLength(1)
  })
  it('fails explicitly for unsupported financial conditions and unproven units or historical edits', async () => {
    for (const extra of [{ vatSummary: {} }, { payment: { method: 'card' } }, { creditTerms: {} }]) expect((await store.addOrder({ ...input(), ...extra })).ok).toBe(false)
    store.products[0].serverUnits = []; expect((await store.addOrder(input())).ok).toBe(false)
    store.orders = [{ id: 'historical', status: 'new' }]; expect((await store.updateOrder('historical', input(), {})).ok).toBe(false)
    expect(h.box.items()).toHaveLength(0)
  })
  it('validates exact decimal arithmetic, discount type and receipt fingerprint', async () => {
    const c = prepareCommercial({ ...input(), items: [{ ...input().items[0], qty: 0.3, price: 1.01 }], rounding: 'kopeck', discountSpec: { kind: 'absolute', value: '0.10' } }, store.products, null, () => 'line')
    expect(c.subtotal).toBe('0.30'); expect(c.total).toBe('0.20')
    const payload = { contractVersion: 2, commandId: 'cmd', orderId: 'o', commercial: c }
    const body = { ok: true, contractVersion: 2, commandId: 'cmd', order: { id: 'o', rowVersion: '20', commercial: c }, fingerprint: createHash('sha256').update(canonicalPayload({ companyId: 'a', operation: 'create', ...payload })).digest('hex') }
    expect(await verifyCommercialResponse('commercial_create', payload, body, 'a')).toBe(true)
    expect(await verifyCommercialResponse('commercial_create', payload, { ...body, fingerprint: 'bad' }, 'a')).toBe(false)
  })
  it('a damaged or failed authority write is never treated as a confirmed server version', async () => {
    await store.addOrder(input()); const op = h.box.items()[0], write = storage.setItem.bind(storage)
    storage.setItem = (key, value) => { if (key.includes('.commercial.')) throw Error('quota'); write(key, value) }
    expect(() => confirm(op)).toThrow('quota'); expect(h.box.items()).toHaveLength(1)
    storage.setItem = write; storage.setItem('sklad.db.v3.u:a.commercial.bad.20', '{')
    expect(() => h.cache.overlayLocal(h.ctx, emptyCloudData())).toThrow()
  })
})
