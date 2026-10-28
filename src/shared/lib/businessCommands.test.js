import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOutbox, safeStorage } from './outbox'
import { completeBusinessAction, unfinishedBusinessIntents, resumeBusinessIntent } from './businessIntent'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { createDocumentsSlice } from '../store/slices/documentsSlice'
import { makeSeed } from '../store/seed'

const h = vi.hoisted(() => ({ context: { userId: 'u', companyId: 'a', generation: 1 }, box: null, cacheError: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.context }),
  isAuthContextCurrent: (c) => JSON.stringify(c) === JSON.stringify(h.context) }))
vi.mock('./scopedCache', () => ({ companyCache: { error: () => h.cacheError, overlayLocal: (_ctx, state) => state } }))
vi.mock('./cloud', () => ({ enqueueSale: (obj) => h.box.enqueueCommand({ ...h.context, key: 'sale', id: obj.order?.id || obj.id, obj }),
  enqueueDocument: (obj) => h.box.enqueueCommand({ ...h.context, key: 'doc_post', id: obj.id, obj }),
  enqueueOrderStatus: (id, status) => h.box.enqueueCommand({ ...h.context, key: 'order_status', id: `${id}:${status}`, obj: { orderId: id, status } }) }))

function lockManager() {
  const tails = new Map()
  return { request: (name, run) => {
    const result = (tails.get(name) || Promise.resolve()).then(run)
    tails.set(name, result.catch(() => {})); return result
  } }
}
const boxes = []
let storage, locks, failWrite
const command = (qty = 1) => ({ userId: 'u', companyId: 'a', key: 'sale', id: 'same', obj: { items: [{ qty }], discount: 0 } })
const box = (opts = {}) => {
  const b = createOutbox({ storage, locks, context: h.context, yieldControl: async () => {}, send: async (batch) => ({ sent: batch }), ...opts })
  boxes.push(b); return b
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('sessionStorage', safeStorage())
  h.context = { userId: 'u', companyId: 'a', generation: 1 }; h.cacheError = null
  const backing = safeStorage(); failWrite = false; locks = lockManager()
  storage = { get length() { return backing.length }, key: (i) => backing.key(i), getItem: (k) => backing.getItem(k),
    removeItem: (k) => backing.removeItem(k), setItem: (k, v) => {
      if (failWrite && k.includes('.op.')) throw new Error('QuotaExceededError')
      backing.setItem(k, v)
    } }
  h.box = box()
})
afterEach(() => { boxes.splice(0).forEach((b) => b.destroy()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('durable immutable business commands', () => {
  it('write failure never creates a memory-only accepted command, including reload', async () => {
    failWrite = true
    expect(await h.box.enqueueCommand(command())).toMatchObject({ ok: false, code: 'STORAGE_ERROR' })
    expect(h.box.status()).toMatchObject({ pending: 0, state: 'error' })
    expect(box().items()).toEqual([])
    failWrite = false
    expect(await h.box.enqueueCommand(command())).toMatchObject({ ok: true })
    expect(box().items()[0]).toMatchObject(command())
  })
  it('rejects a silent storage no-op and unavailable cross-tab locks', async () => {
    expect(await box({ storage: { ...storage, setItem: () => {} } }).enqueueCommand(command())).toMatchObject({ ok: false, code: 'STORAGE_ERROR' })
    expect(await box({ locks: {} }).enqueueCommand(command())).toMatchObject({ ok: false, code: 'LOCK_UNAVAILABLE' })
  })
  it('rejects changed payload and keeps the original persisted key after acknowledgement', async () => {
    const first = await h.box.enqueueCommand(command())
    expect(await h.box.enqueueCommand(command(2))).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    await h.box.flushNow()
    expect(await box().enqueueCommand(command())).toMatchObject({ ok: true, duplicate: true, acknowledged: true, entryId: first.entryId })
    expect(await box().enqueueCommand(command(2))).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
  })
  it('identical payload with reordered object fields reuses the saved revision', async () => {
    const first = await h.box.enqueueCommand(command())
    const reordered = { ...command(), obj: { discount: 0, items: [{ qty: 1 }] } }
    expect(await h.box.enqueueCommand(reordered)).toMatchObject({ ok: true, duplicate: true, entryId: first.entryId })
    expect(h.box.items()).toHaveLength(1)
  })
  it('existing conflicting revisions are preserved and blocked from automatic sending', async () => {
    storage.setItem('sklad.outbox.v2.u:a.op.old-1', JSON.stringify({ ...command(), _entryId: 'old-1', _order: 1 }))
    storage.setItem('sklad.outbox.v2.u:a.op.old-2', JSON.stringify({ ...command(2), _entryId: 'old-2', _order: 2 }))
    const send = vi.fn(), restored = box({ send })
    expect(restored.quarantined()[0]._quarantineReason.code).toBe('COMMAND_CONFLICT')
    expect(await restored.enqueueCommand(command(2))).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    await restored.flushNow(); expect(send).not.toHaveBeenCalled()
    expect(storage.getItem('sklad.outbox.v2.u:a.op.old-1')).not.toBeNull()
    expect(storage.getItem('sklad.outbox.v2.u:a.op.old-2')).not.toBeNull()
  })
  it('two tabs with the same ID serialize conflict checking and cannot overwrite commands', async () => {
    const other = box()
    const results = await Promise.all([h.box.enqueueCommand(command()), other.enqueueCommand(command(2))])
    expect(results[0].ok).toBe(true); expect(results[1]).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    expect(other.items()[0].obj.items[0].qty).toBe(1)
    expect(await other.enqueueCommand(command())).toMatchObject({ ok: true, duplicate: true, entryId: results[0].entryId })
  })
  it('late old response cannot acknowledge a conflicting revision or affect another company', async () => {
    let resolve
    const b = box({ send: (batch) => new Promise((r) => { resolve = () => r({ sent: batch }) }) })
    await b.enqueueCommand(command()); const flush = b.flushNow()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    expect(await b.enqueueCommand(command(2))).toMatchObject({ ok: false, code: 'COMMAND_CONFLICT' })
    b.setContext({ userId: 'u', companyId: 'b' })
    await b.enqueueCommand({ ...command(), companyId: 'b' })
    resolve(); await flush
    expect(b.items()).toHaveLength(1)
    b.setContext(h.context); expect(b.items()).toEqual([])
  })
  it('payload is copied on enqueue and deeply frozen for transport', async () => {
    const input = command(), b = box({ send: async (batch) => {
      expect(() => { batch[0].obj.items[0].qty = 999 }).toThrow()
      expect(batch[0].obj.items[0].qty).toBe(1); return { sent: batch }
    } })
    await b.enqueueCommand(input); input.obj.items[0].qty = 2; await b.flushNow()
  })
  it('lost response retries the same payload and idempotency key with one server effect', async () => {
    const server = new Map(), requests = []; let lose = true
    const b = box({ send: async (batch) => {
      const item = batch[0], key = `sale-${item.id}`, payload = JSON.stringify(item.obj)
      requests.push({ key, payload })
      if (!server.has(key)) server.set(key, payload)
      else expect(server.get(key)).toBe(payload)
      if (lose) { lose = false; throw new Error('response lost') }
      return { sent: batch }
    } })
    await b.enqueueCommand(command()); await b.flushNow()
    expect(box().items()).toHaveLength(1)
    await b.flushNow()
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(server.size).toBe(1)
    expect(b.items()).toEqual([])
  })
})

function storeFixture() {
  let state = { ...makeSeed(), cloud: true, authUserId: 'employee', logAction: vi.fn() }
  const get = () => state
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  state = { ...state, ...createOrdersSlice(set, get), ...createDocumentsSlice(set, get), addMoneyTx: vi.fn(), cancelMoneyTx: vi.fn() }
  return { get, set }
}
describe('business action acceptance and recovery', () => {
  it('simultaneous identical sale submissions reuse one ID and apply local stock once', async () => {
    const fixture = storeFixture(), state = fixture.get(), p = state.products[0]
    const input = { warehouseId: state.warehouses[0].id, items: [{ productId: p.id, name: p.name, qty: 1, price: 100 }], total: 100 }
    const [a, b] = await Promise.all([state.createSaleDocument(input), state.createSaleDocument(input)])
    expect(a).toMatchObject({ ok: true, id: b.id })
    expect(fixture.get().orders.filter((o) => o.id === a.id)).toHaveLength(1)
    expect(fixture.get().products.find((x) => x.id === p.id).stock).toBe(p.stock) // no warehouse baseline in this fixture
    expect(h.box.items()).toHaveLength(1)
  })
  it('sale quota error changes neither stock nor money and reload retries original ID', async () => {
    let fixture = storeFixture(), state = fixture.get()
    const p = state.products[0], input = { warehouseId: state.warehouses[0].id, items: [{ productId: p.id, name: p.name, qty: 1, price: 100 }], total: 100 }
    const before = { orders: state.orders, products: state.products, moneyTx: state.moneyTx }
    failWrite = true
    const result = await state.createSaleDocument(input)
    expect(result).toMatchObject({ ok: false, unfinished: true, code: 'STORAGE_ERROR' })
    expect(fixture.get()).toMatchObject(before); expect(state.addMoneyTx).not.toHaveBeenCalled()
    const intent = unfinishedBusinessIntents()[0]; expect(intent.prepared.id).toBe(result.id)
    // New module owner/store/outbox, same browser storages, as after reload.
    h.box.destroy(); h.box = box(); fixture = storeFixture(); failWrite = false
    expect(await resumeBusinessIntent(fixture.get(), intent.storageKey)).toMatchObject({ ok: true, id: result.id })
    expect(h.box.items()[0].id).toBe(result.id); expect(unfinishedBusinessIntents()).toEqual([])
  })
  it('document quota error leaves no receipt and keeps original document ID on retry', async () => {
    const fixture = storeFixture(), before = fixture.get(), p = before.products[0]
    const input = { type: 'stockin', items: [{ productId: p.id, name: p.name, qty: 2, cost: 10 }] }
    failWrite = true
    const rejected = await before.addDocument(input)
    expect(rejected.ok).toBe(false); expect(fixture.get().documents).toEqual(before.documents)
    expect(fixture.get().products).toEqual(before.products)
    failWrite = false
    expect(await fixture.get().addDocument(input)).toBe(rejected.id)
    expect(h.box.items()[0].id).toBe(rejected.id)
  })
  it('changed intention cannot generate a replacement ID after write failure', async () => {
    const prepare = vi.fn(() => ({ id: 'reserved', command: command() })), apply = vi.fn()
    failWrite = true
    const run = (qty) => completeBusinessAction({ cloud: true }, 'sale', { qty }, prepare, (p) => h.box.enqueueCommand(p.command), apply)
    expect((await run(1)).ok).toBe(false)
    expect(await run(2)).toMatchObject({ ok: false, code: 'INTENT_CONFLICT', id: 'reserved' })
    failWrite = false; await run(1)
    expect(prepare).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledTimes(1)
  })
  it('sessionStorage failure rejects before enqueue or touching local state', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('quota') } })
    const enqueue = vi.fn(), apply = vi.fn()
    expect(await completeBusinessAction({ cloud: true }, 'sale', {}, () => ({ id: 'x' }), enqueue, apply)).toMatchObject({ ok: false, code: 'INTENT_STORAGE_ERROR' })
    expect(enqueue).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
  })
  it('local application exception rolls back sale and retains accepted unfinished command', async () => {
    const fixture = storeFixture(), before = fixture.get(), p = before.products[0]
    fixture.set({ setOrderStatus: () => { throw new Error('local failure') } })
    const result = await fixture.get().createSaleDocument({ warehouseId: before.warehouses[0].id, items: [{ productId: p.id, qty: 1, price: 100 }], total: 100 })
    expect(result).toMatchObject({ ok: false, accepted: true, unfinished: true, code: 'LOCAL_APPLY_ERROR' })
    expect(fixture.get().orders).toEqual(before.orders); expect(fixture.get().products).toEqual(before.products)
    expect(h.box.items()).toHaveLength(1); expect(unfinishedBusinessIntents()).toHaveLength(1)
  })
  it('cache error keeps the accepted command visibly unfinished', async () => {
    h.cacheError = 'quota'
    const result = await completeBusinessAction({ cloud: true }, 'sale', {}, () => ({ id: 'x' }),
      () => h.box.enqueueCommand(command()), () => ({ ok: true }))
    expect(result).toMatchObject({ ok: false, accepted: true, unfinished: true, code: 'CACHE_STORAGE_ERROR' })
    expect(h.box.items()).toHaveLength(1); expect(unfinishedBusinessIntents()).toHaveLength(1)
  })
  it('late acceptance after session switch retains intent and never mutates new session', async () => {
    let resolve; const apply = vi.fn()
    const pending = completeBusinessAction({ cloud: true }, 'sale', {}, () => ({ id: 'x' }), () => new Promise((r) => { resolve = r }), apply)
    h.context = { ...h.context, companyId: 'b', generation: 2 }; resolve({ ok: true })
    expect(await pending).toMatchObject({ ok: false, accepted: true, code: 'CONTEXT_CHANGED' })
    expect(apply).not.toHaveBeenCalled(); expect(unfinishedBusinessIntents()).toEqual([])
    h.context = { ...h.context, companyId: 'a', generation: 3 }; expect(unfinishedBusinessIntents()).toHaveLength(1)
  })
})
