import { describe, it, expect } from 'vitest'
import { createScopedCache } from './scopedCache'
import { safeStorage, scopeKey } from './outbox'
import { applyOrderStock } from './orders'

const A = { userId: 'u', companyId: 'a', generation: 1 }
const B = { userId: 'u', companyId: 'b', generation: 2 }
function fixture(storage = safeStorage(), context = A) {
  const cache = createScopedCache({ storage, getContext: () => context,
    isCurrent: (ctx) => ctx.userId === context.userId && ctx.companyId === context.companyId && ctx.generation === context.generation })
  cache.activate(context)
  const prefix = 'sklad.outbox.v2.' + scopeKey(context) + '.'
  const command = (key, id, obj, order = 1) => {
    const op = { ...context, key, id, obj, op: 'create', _order: order, _entryId: key + '-' + id }
    storage.setItem(prefix + 'op.' + op._entryId, JSON.stringify(op)); return op
  }
  const save = (products, extra = {}) => cache.setItem('db', JSON.stringify({ version: 19,
    state: { authAccountId: context.userId, companyId: context.companyId, products, ...extra } }))
  const pull = (stock, orders = [], rowVersion = '1', covered = []) => {
    const data = { products: [{ id: 'p', name: 'Server', stock, batches: [], cost: 10, rowVersion }], orders, documents: [] }
    cache.captureStock(context, data, covered); return data
  }
  return { cache, storage, context, prefix, command, save, pull,
    read: () => cache.read(context).state.products[0],
    overlay: (data) => cache.overlayLocal(context, data).products[0] }
}
const sale = { id: 's', items: [{ productId: 'p', qty: 1 }], kind: 'retail' }
const serverSale = { ...sale, status: 'delivered', stockConsumed: true }

describe('server stock with durable local intentions', () => {
  it('server 44 wins over stale local catalogue stock 0, including STALE quarantine', () => {
    const f = fixture()
    const op = f.command('products', 'p', { id: 'p', stock: 0, batches: [], cost: 0 })
    f.storage.setItem(f.prefix + 'meta.' + op._entryId, JSON.stringify({ _quarantined: true, _quarantineReason: { code: 'STALE' } }))
    f.save([{ id: 'p', stock: 0, batches: [], cost: 0, name: 'Local name' }])
    const result = f.overlay(f.pull(44))
    expect(result).toMatchObject({ stock: 44, confirmedStock: 44, pendingStockDelta: 0, cost: 10, name: 'Local name' })
    f.save([result])
    expect(fixture(f.storage).read().stock).toBe(44)
    expect(f.storage.getItem(f.prefix + 'op.' + op._entryId)).not.toBeNull()
    expect(f.storage.getItem(f.prefix + 'meta.' + op._entryId)).toContain('STALE')
  })
  it('empty batches do not erase confirmed or legacy positive numeric stock', () => {
    for (const product of [{ id: 'p', stock: 45, batches: [] }, { id: 'p', stock: 45, confirmedStock: 45, pendingStockDelta: 0, batches: [] }]) {
      const next = applyOrderStock({ products: [product] }, sale, -1).products[0]
      expect(next.stock).toBe(44)
      if (product.confirmedStock != null) expect(next).toMatchObject({ confirmedStock: 45, pendingStockDelta: -1 })
    }
  })
  it('offline sale is projected once, survives reload and acknowledgement before a new pull', () => {
    const f = fixture(); const data = f.pull(45); f.save(data.products)
    const op = f.command('sale', 's', sale)
    expect(f.read()).toMatchObject({ stock: 44, confirmedStock: 45, pendingStockDelta: -1 })
    const next = fixture(f.storage)
    expect(next.read().stock).toBe(44)
    f.storage.setItem(f.prefix + 'ack.' + op._entryId, 'confirmed')
    expect(next.read().stock).toBe(44)
    const fresh = f.overlay(f.pull(44, [serverSale], '2', [op._entryId]))
    expect(fresh).toMatchObject({ stock: 44, confirmedStock: 44, pendingStockDelta: 0 })
    f.save([fresh]); expect(fixture(f.storage).read().stock).toBe(44)
  })
  it('lost HTTP response does not double apply a sale already present on the server', () => {
    const f = fixture(); f.command('sale', 's', sale)
    expect(f.overlay(f.pull(44, [serverSale])).stock).toBe(44)
    expect(f.overlay(f.pull(44, [serverSale])).pendingStockDelta).toBe(0)
  })
  it('two tabs see the same durable sale despite stale saved product snapshots', () => {
    const first = fixture(), second = fixture(first.storage)
    first.save(first.pull(45).products); second.cache.read(A)
    first.command('sale', 's', sale)
    second.save([{ id: 'p', stock: 0, batches: [] }])
    expect(first.read().stock).toBe(44); expect(second.read().stock).toBe(44)
    first.save([first.overlay(first.pull(44, [serverSale], '20'))])
    second.pull(45, [], '10') // Late response from the older server revision.
    expect(second.read().stock).toBe(44)
  })
  it('identical product and command IDs in different companies stay isolated', () => {
    const a = fixture(), b = fixture(a.storage, B)
    a.save(a.pull(45).products); b.save(b.pull(100).products)
    a.command('sale', 's', sale); b.command('sale', 's', { ...sale, items: [{ productId: 'p', qty: 5 }] })
    expect(a.read().stock).toBe(44); expect(b.read().stock).toBe(95)
  })
  it('sale then cancellation preserves dependency order before and after server confirmation', () => {
    const f = fixture(); f.command('sale', 's', sale); const cancel = f.command('order_status', 's:cancelled', { orderId: 's', status: 'cancelled' }, 2)
    expect(f.overlay(f.pull(45)).stock).toBe(45)
    expect(f.overlay(f.pull(44, [serverSale], '2')).stock).toBe(45)
    expect(f.overlay(f.pull(45, [{ ...serverSale, status: 'cancelled' }], '3', [cancel._entryId])).stock).toBe(45)
  })
  it('snapshot write failure is visible and keeps the outbox and previous baseline intact', () => {
    const f = fixture(); f.save(f.pull(45).products); const op = f.command('sale', 's', sale)
    const write = f.storage.setItem.bind(f.storage)
    f.storage.setItem = (key, value) => { if (key.includes('.stock.')) throw new Error('QuotaExceededError'); write(key, value) }
    expect(() => f.pull(44, [serverSale], '2')).toThrow('QuotaExceededError')
    expect(f.cache.error()).toBe('QuotaExceededError'); expect(f.read().stock).toBe(44)
    expect(f.storage.getItem(f.prefix + 'op.' + op._entryId)).not.toBeNull()
  })
  it('legacy catalogue migration preserves the original without treating its stock as authoritative', () => {
    const f = fixture(); f.command('products', 'p', { id: 'p', stock: 0 })
    const original = JSON.stringify({ ...A, state: { products: [{ id: 'p', stock: 0 }] } })
    f.storage.setItem('sklad.db.v2.' + scopeKey(A), original); f.cache.read(A)
    expect(f.overlay(f.pull(44)).stock).toBe(44)
    expect(f.storage.getItem('sklad.db.v2.' + scopeKey(A))).toBe(original)
  })
  it('queued order header does not consume stock until its durable shipment command', () => {
    const f = fixture(); f.command('orders', 's', { ...sale, status: 'shipped', stockConsumed: true }, 3)
    expect(f.overlay(f.pull(45)).stock).toBe(45)
    f.command('order_status', 's:shipped', { orderId: 's', status: 'shipped' }, 2)
    expect(f.overlay(f.pull(45)).stock).toBe(44)
  })
  it('pending document uses payload units, skips server-confirmed IDs and leaves transfers neutral', () => {
    const f = fixture(); const op = f.command('doc_post', 'd', { id: 'd', type: 'receive', items: [{ productId: 'p', qty: 2, unitFactor: 5 }] })
    expect(f.overlay(f.pull(45)).stock).toBe(55)
    f.command('doc_post', 't', { id: 't', type: 'transfer', items: [{ productId: 'p', qty: 10 }] }, 2)
    expect(f.overlay(f.pull(55, [], '2', [op._entryId])).stock).toBe(55)
  })
})
