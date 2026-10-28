import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutbox, safeStorage } from './outbox'
import { createScopedCache } from './scopedCache'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { prepareOfflineRefund } from './offlineRefunds'
import { unfinishedBusinessIntents } from './businessIntent'

const h = vi.hoisted(() => ({ context: { userId: 'u', companyId: 'a', generation: 1 }, box: null, cache: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.context }),
  isAuthContextCurrent: (ctx) => JSON.stringify(ctx) === JSON.stringify(h.context) }))
vi.mock('./scopedCache', async (original) => ({ ...await original(), companyCache: {
  error: () => h.cache.error(), overlayLocal: (...args) => h.cache.overlayLocal(...args),
} }))
vi.mock('./cloud', () => ({ enqueueSale: vi.fn(), enqueueOrderStatus: vi.fn(),
  enqueueReturn: (obj) => h.box.enqueueCommand({ ...h.context, key: 'return_v2', id: obj.request.returnId, op: 'create', obj }) }))

const order = { id: 's', no: 'ЧК-1', total: 300, status: 'delivered', stockConsumed: true, shipmentDocId: 'sale-s',
  items: [{ productId: 'p', name: 'Product', qty: 3, qtyBase: '3', price: 100, saleLineId: 'sale-s-0' }], returns: [] }
let storage, backing, failWrite, boxes
const locks = { request: async (_name, run) => run() }
function box(send = async () => { throw new Error('NETWORK') }) {
  const result = createOutbox({ storage, locks, context: h.context, debounceMs: 100000, send })
  boxes.push(result); return result
}
function cache() {
  const result = createScopedCache({ storage, getContext: () => h.context,
    isCurrent: (ctx) => JSON.stringify(ctx) === JSON.stringify(h.context) })
  result.activate(h.context); return result
}
function fixture(fromCache = false) {
  h.cache = cache()
  let state = { cloud: true, authAccountId: 'u', companyId: 'a', moneyTx: [], customers: [], documents: [],
    products: [{ id: 'p', stock: 44, rowVersion: '1' }], orders: [structuredClone(order)], logAction: vi.fn(), addMoneyTx: vi.fn(),
    ...(fromCache ? h.cache.read(h.context)?.state : {}) }
  if (!fromCache) h.cache.captureStock(h.context, state)
  const get = () => state
  const set = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    h.cache.setItem('db', JSON.stringify({ state }))
  }
  state = { ...state, ...createOrdersSlice(set, get) }
  set({})
  return { get, set, refund: () => get().refundOrder('s', { items: [{ productId: 'p', qty: 1 }] }) }
}
beforeEach(() => {
  h.context = { userId: 'u', companyId: 'a', generation: 1 }; boxes = []; failWrite = false
  vi.stubGlobal('sessionStorage', safeStorage()); backing = safeStorage()
  storage = { get length() { return backing.length }, key: (i) => backing.key(i), getItem: (k) => backing.getItem(k),
    removeItem: (k) => backing.removeItem(k), setItem: (k, v) => {
      if (failWrite && k.includes('.op.')) throw new Error('QuotaExceededError')
      backing.setItem(k, v)
    } }
  h.box = box()
})
afterEach(() => { boxes.forEach((b) => b.destroy()); vi.unstubAllGlobals() })

describe('durable offline return v2', () => {
  it('offline refund and offline reload keep the same ID, payload and stock overlay without a money fact', async () => {
    const f = fixture(), result = await f.refund()
    expect(result).toMatchObject({ ok: true, pending: true })
    const saved = h.box.items()[0]
    expect(saved.obj.request).toMatchObject({ contractVersion: 2, returnId: result.returnId, orderId: 's',
      items: [{ saleLineId: 'sale-s-0', qtyBase: '1.0000' }] })
    expect(f.get().products[0]).toMatchObject({ stock: 45, confirmedStock: 44, pendingStockDelta: 1 })
    expect(f.get().moneyTx).toEqual([]); expect(f.get().addMoneyTx).not.toHaveBeenCalled()
    await h.box.flushNow()
    h.box.destroy(); h.box = box()
    const reload = fixture(true)
    expect(h.box.items()[0].obj).toEqual(saved.obj)
    expect(reload.get().products[0].stock).toBe(45)
    expect(reload.get().orders.find((row) => row.returnId === result.returnId)).toMatchObject({ refundState: 'pending', total: 0 })
  })
  it('write failure changes neither stock nor money; reload retries the reserved identity', async () => {
    const f = fixture(); failWrite = true
    const first = await f.refund()
    expect(first).toMatchObject({ ok: false, code: 'STORAGE_ERROR', unfinished: true })
    expect(f.get().products[0].stock).toBe(44); expect(f.get().moneyTx).toEqual([])
    expect(box().items()).toEqual([])
    expect(unfinishedBusinessIntents()[0].prepared.id).toBe(first.id)
    failWrite = false; h.box.destroy(); h.box = box()
    const reload = fixture(true)
    expect(await reload.refund()).toMatchObject({ ok: true, returnId: first.id })
    expect(h.box.items()).toHaveLength(1)
  })
  it('two independent identical refunds have different IDs and reserve quantity within the original limit', async () => {
    const f = fixture(), first = await f.refund(), second = await f.refund()
    expect(first.ok && second.ok).toBe(true); expect(first.returnId).not.toBe(second.returnId)
    expect(f.get().products[0].stock).toBe(46)
    expect((await f.refund()).ok).toBe(true)
    expect((await f.refund()).ok).toBe(false)
    expect(h.box.items()).toHaveLength(3); expect(f.get().products[0].stock).toBe(47)
  })
  it('STALE quarantine survives reload and cannot be silently removed', async () => {
    const f = fixture(), result = await f.refund()
    h.box.quarantine(result.returnId, 'return_v2', { code: 'STALE', error: 'Review required' })
    expect(h.box.removeQuarantined(result.returnId, 'return_v2')).toBe(false)
    expect(fixture(true).get().products[0].stock).toBe(45)
    expect(fixture(true).get().orders.find((row) => row.returnId === result.returnId).refundState).toBe('review')
    const send = vi.fn(); await box(send).flushNow(); expect(send).not.toHaveBeenCalled()
  })
  it('company switch and logout stop sends without losing the original company command', async () => {
    const f = fixture(), result = await f.refund(), send = vi.fn()
    const sender = box(send)
    h.context = { userId: 'u', companyId: 'b', generation: 2 }; sender.setContext(h.context)
    await sender.flushNow(); expect(send).not.toHaveBeenCalled()
    sender.setContext(null); await sender.flushNow(); expect(send).not.toHaveBeenCalled()
    h.context = { userId: 'u', companyId: 'a', generation: 3 }; sender.setContext(h.context)
    expect(sender.items()[0].id).toBe(result.returnId)
    expect(cache().read(h.context).state.products[0].stock).toBe(45)
  })
  it('lost response, retry and confirmation never apply the stock adjustment twice', async () => {
    const f = fixture(), result = await f.refund(), commands = h.box.items()
    let committed = false, attempts = 0, postings = 0
    const sender = box(async (batch) => {
      attempts++; if (!committed) { committed = true; postings++; throw new Error('lost response') }
      return { sent: batch }
    })
    await sender.flushNow(); await sender.flushNow()
    expect(attempts).toBe(2); expect(postings).toBe(1); expect(sender.items()).toEqual([])
    // Ack alone cannot remove the delta against the old baseline.
    expect(cache().read(h.context).state.products[0].stock).toBe(45)
    const confirmed = { ...structuredClone(order), returns: [{ contractVersion: 2, returnId: result.returnId,
      documentId: `ret-${result.returnId}`, orderId: 's', items: [{ saleLineId: 'sale-s-0', productId: 'p', qtyBase: '1', amountMinor: '10000' }], amountMinor: '10000' }] }
    h.cache.captureStock(h.context, { products: [{ id: 'p', stock: 45, rowVersion: '2' }], orders: [confirmed] }, commands.map((c) => c._entryId))
    f.set({ orders: [confirmed] })
    expect(fixture(true).get().products[0]).toMatchObject({ stock: 45, pendingStockDelta: 0 })
    expect(fixture(true).get().orders.find((row) => row.returnId === result.returnId).refundState).toBe('confirmed')
    expect(fixture(true).get().orders.find((row) => row.returnId === result.returnId).items[0]).toMatchObject({ name: 'Product', qty: 1, price: 100 })
  })
  it('ordinary kind:refund header is not proof of a server-confirmed return', async () => {
    const f = fixture(), result = await f.refund()
    h.cache.captureStock(h.context, { products: [{ id: 'p', stock: 44, rowVersion: '2' }],
      orders: [order, { kind: 'refund', id: `return-${result.returnId}`, returnId: result.returnId }] })
    expect(cache().read(h.context).state.products[0].stock).toBe(45)
  })
  it('requires fixed server line IDs and never invents them from product or time', () => {
    expect(() => prepareOfflineRefund({ ...order, items: [{ productId: 'p', qty: 3, price: 100 }] }, [],
      { items: [{ productId: 'p', qty: 1 }] })).toThrow('подтверждённых строк')
  })
  it('server v2 history proves a committed return even before acknowledgement is saved', async () => {
    const f = fixture(), result = await f.refund()
    const confirmed = { ...order, returns: [{ contractVersion: 2, returnId: result.returnId,
      documentId: `ret-${result.returnId}`, orderId: 's', amountMinor: '10000', items: [] }] }
    const data = { products: [{ id: 'p', stock: 45, rowVersion: '2' }], orders: [confirmed] }
    h.cache.captureStock(h.context, data, [])
    expect(h.cache.overlayLocal(h.context, data).products[0]).toMatchObject({ stock: 45, pendingStockDelta: 0 })
    expect(h.box.items()).toHaveLength(1)
  })
  it('cannot cancel a sale with a saved return, including a peer tab whose visible state is stale', async () => {
    const f = fixture(), before = f.get()
    await f.refund()
    // Restore the peer's stale visible state; the journal still contains the return.
    f.set({ orders: before.orders, products: before.products })
    expect(f.get().cancelOrder('s')).toMatchObject({ ok: false })
    expect(f.get().orders.find((row) => row.id === 's').status).toBe('delivered')
    expect(h.box.items('return_v2')).toHaveLength(1)
  })
})
