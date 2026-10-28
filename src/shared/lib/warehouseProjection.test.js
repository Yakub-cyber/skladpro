import { describe, it, expect } from 'vitest'
import { createScopedCache } from './scopedCache'
import { safeStorage } from './outbox'
import { warehouseCommandRequest } from './stockProjection'
import { inventoryView } from './inventoryView'
import { applyDocToState } from './posting'

const A = { userId: 'u', companyId: 'a', generation: 1 }
const request = (commands = []) => ({ contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands })
function fixture(storage = safeStorage(), context = A) {
  const cache = createScopedCache({ storage, getContext: () => context, isCurrent: (c) => c.userId === context.userId && c.companyId === context.companyId && c.generation === context.generation })
  cache.activate(context)
  const prefix = `sklad.outbox.v2.${context.userId}:${context.companyId}.`
  const command = (id, type = 'adjust', warehouseId = 'A', qty = 30, order = 1) => {
    const op = { ...context, id, key: 'doc_post', op: 'create', _order: order, _entryId: id, obj: { id, type, warehouseId, items: [{ productId: 'p', qty }] } }
    storage.setItem(prefix + 'op.' + id, JSON.stringify(op)); return op
  }
  const save = (qty = 40, ops = [], resolutions = [], before) => {
    const req = request(ops.map(warehouseCommandRequest)), snapshot = { contractVersion: 1, requestId: req.requestId, companyId: context.companyId,
      snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot',
      coverage: { complete: true, missingBalanceMeansZero: true, productIds: ['p'], warehouseScope: 'all-company-warehouses' },
      warehouses: [{ id: 'A', active: true }, { id: 'B', active: true }], balances: [{ productId: 'p', warehouseId: 'A', qtyBase: String(qty) }, { productId: 'p', warehouseId: 'B', qtyBase: '60' }],
      totals: [{ productId: 'p', qtyBase: String(qty + 60) }], commands: ops.map((op, i) => ({ commandId: op.id, resolution: resolutions[i] || 'not_observed', effectIncluded: resolutions[i] === 'applied' ? true : ['unverifiable', 'conflict'].includes(resolutions[i]) ? null : false, documentId: resolutions[i] === 'applied' ? op.id : null, reason: 'PROOF' })) }
    cache.saveWarehouseSnapshot(context, req, snapshot, before)
    return snapshot
  }
  return { cache, storage, prefix, command, save, view: () => cache.warehouseProjection(context).get('p') }
}

describe('warehouse inventory projection from an atomic baseline', () => {
  it('A40 B60 -> A30 B60 total90; the immutable baseline and payload stay unchanged', () => {
    const f = fixture(), base = f.save(), op = f.command('i'), raw = f.storage.getItem(f.prefix + 'op.i')
    expect(f.view()).toMatchObject({ available: true, confirmedTotal: 100, total: 90, warehouses: { A: { confirmed: 40, projected: 30 }, B: { confirmed: 60, projected: 60 } } })
    expect(f.cache.readWarehouseSnapshot(A)).toEqual(base)
    expect(f.storage.getItem(f.prefix + 'op.i')).toBe(raw); expect(op.obj.items[0].qty).toBe(30)
  })
  it('counts warehouse B and applies two counts in journal order', () => {
    const f = fixture(); f.save(); f.command('b', 'adjust', 'B', 50)
    expect(f.view().total).toBe(90)
    f.command('a1', 'adjust', 'A', 30, 2); f.command('a2', 'adjust', 'A', 25, 3)
    expect(f.view()).toMatchObject({ total: 75, warehouses: { A: { projected: 25 }, B: { projected: 50 } } })
  })
  it.each([true, false])('a receipt before/after inventory preserves operation order: receipt first=%s', (first) => {
    const f = fixture(); f.save()
    f.command('receipt', 'receive', 'A', 5, first ? 1 : 2); f.command('inventory', 'adjust', 'A', 30, first ? 2 : 1)
    expect(f.view().total).toBe(first ? 90 : 95)
  })
  it.each([true, false])('a transfer before/after inventory touches both warehouses: transfer first=%s', (first) => {
    const f = fixture(); f.save()
    const transfer = f.command('transfer', 'transfer', 'A', 10, first ? 1 : 2)
    transfer.obj.warehouseToId = 'B'; f.storage.setItem(f.prefix + 'op.transfer', JSON.stringify(transfer))
    f.command('inventory', 'adjust', 'A', 30, first ? 2 : 1)
    expect(f.view()).toMatchObject({ total: first ? 100 : 90, warehouses: { A: { projected: first ? 30 : 20 }, B: { projected: 70 } } })
  })
  it('no warehouse or no verified snapshot yields no invented stock', () => {
    const f = fixture(); f.command('old', 'adjust', undefined)
    expect(f.view()).toBeUndefined()
    const op = JSON.parse(f.storage.getItem(f.prefix + 'op.old')); delete op.obj.warehouseId; f.storage.setItem(f.prefix + 'op.old', JSON.stringify(op))
    f.save(40, [op])
    expect(f.view()).toMatchObject({ available: false, total: null, reason: 'WAREHOUSE_UNKNOWN' })
  })
  it.each(['STALE', 'VALIDATION_ERROR'])('quarantine %s blocks numerical projection without removing the command', (code) => {
    const f = fixture(); f.save(); f.command('i')
    f.storage.setItem(f.prefix + 'meta.i', JSON.stringify({ _quarantined: true, _quarantineReason: { code } }))
    expect(f.view()).toMatchObject({ available: false, reason: code, total: null })
    expect(f.storage.getItem(f.prefix + 'op.i')).not.toBeNull()
  })
  it('a lost response and unverifiable server document require reconciliation; transport receipt before a new snapshot prevents double application', () => {
    const f = fixture(); f.save(); const op = f.command('i')
    expect(f.view().total).toBe(90)
    f.save(30, [op], ['unverifiable'])
    expect(f.view()).toMatchObject({ available: false, total: null })
    f.storage.setItem(f.prefix + 'ack.i', 'confirmed')
    const before = f.cache.prepareWarehouseSnapshot(A)
    f.save(30, [op], ['unverifiable'], before)
    expect(f.view()).toMatchObject({ available: true, total: 90, warehouses: { A: { projected: 30 } } })
  })
  it('applied is tied to the exact request; changed commands do not inherit an old proof', () => {
    const f = fixture(), op = f.command('i'); f.save(30, [op], ['applied'])
    expect(f.view().total).toBe(90)
    const changed = { ...op, obj: { ...op.obj, items: [{ productId: 'p', qty: 20 }] } }
    f.storage.setItem(f.prefix + 'op.i', JSON.stringify(changed))
    expect(f.view()).toMatchObject({ available: false, reason: 'COMMAND_NOT_RECONCILED' })
  })
  it.each(['not_observed', 'unverifiable', 'conflict'])('%s is not a transport acknowledgement and never removes the command', (resolution) => {
    const f = fixture(), op = f.command('i'); f.save(40, [op], [resolution])
    expect(f.view().available).toBe(resolution === 'not_observed')
    expect(f.view().total).toBe(resolution === 'not_observed' ? 90 : null)
    expect(f.storage.getItem(f.prefix + 'ack.i')).toBe(null)
    expect(f.storage.getItem(f.prefix + 'op.i')).not.toBe(null)
  })
  it('commands introduced while an atomic read was in flight cannot be presumed absent', () => {
    const f = fixture(), before = f.cache.prepareWarehouseSnapshot(A)
    f.command('during-read'); f.save(40, [], [], before)
    expect(f.view()).toMatchObject({ available: false, reason: 'COMMAND_NOT_RECONCILED' })
  })
  it('reload and two tabs recover the same projection while companies stay isolated', () => {
    const f = fixture(); f.save(); f.command('i')
    expect(fixture(f.storage).view().total).toBe(90)
    expect(f.view().total).toBe(90)
    expect(fixture(f.storage, { ...A, companyId: 'b' }).view()).toBeUndefined()
  })
  it.each(['sale', 'return_v2'])('an unresolved %s without a proven warehouse makes the affected product unavailable', (key) => {
    const f = fixture(); f.save()
    const op = { ...A, id: 's', key, _entryId: 's', _order: 1, obj: key === 'sale' ? { id: 's', items: [{ productId: 'p', qty: 1 }] } :
      { request: { returnId: 's', orderId: 'o', items: [{ saleLineId: 'l', qtyBase: '1.0000' }] }, projection: { items: [{ productId: 'p', saleLineId: 'l', qtyBase: '1.0000' }] } } }
    f.storage.setItem(f.prefix + 'op.s', JSON.stringify(op))
    expect(f.view()).toMatchObject({ available: false, reason: 'WAREHOUSE_UNKNOWN', total: null })
  })
  it('the form model uses the selected warehouse, never a product total or batches', () => {
    const f = fixture(); f.save()
    const products = [{ id: 'p', stock: 0, batches: [] }], projection = f.cache.warehouseProjection(A)
    expect(inventoryView(products, projection, '', { p: '30' })[0].previous).toBe(null)
    expect(inventoryView(products, projection, 'A')[0].previous).toBe(40)
    expect(inventoryView(products, projection, 'B')[0].previous).toBe(60)
    expect(inventoryView(products, projection, 'A', { p: '30' })[0].diff).toBe(-10)
  })
  it('cloud inventory does not fabricate batches, warehouse ledger rows or money facts', () => {
    const state = { cloud: true, products: [{ id: 'p', stock: 100, batches: [] }], movements: [], moneyTx: [] }
    expect(applyDocToState(state, { type: 'inventory', warehouseId: 'A', items: [{ productId: 'p', qty: 30 }] }, 1, 'u')).toEqual({ products: state.products, movements: [] })
    expect(state.moneyTx).toEqual([])
  })
})
