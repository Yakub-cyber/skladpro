import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentsSlice } from './documentsSlice'
import { createScopedCache } from '../../lib/scopedCache'
import { createOutbox, safeStorage } from '../../lib/outbox'
const h = vi.hoisted(() => ({ context: { userId: 'u', companyId: 'a', generation: 1 }, cache: null, box: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => h.context, isAuthContextCurrent: (c) => c.userId === 'u' && c.companyId === 'a' && c.generation === 1 }))
vi.mock('../../lib/cloud', () => ({ enqueueDocument: (obj) => h.box.enqueueCommand({ ...h.context, id: obj.id, key: 'doc_post', op: 'create', obj }) }))
vi.mock('../../lib/scopedCache', async (original) => ({ ...await original(), companyCache: { overlayLocal: (...args) => h.cache.overlayLocal(...args), error: () => h.cache.error() } }))
let state, storage
beforeEach(() => {
  storage = safeStorage(); vi.stubGlobal('sessionStorage', safeStorage())
  h.cache = createScopedCache({ storage, getContext: () => h.context, isCurrent: (c) => c.generation === 1 && c.companyId === 'a' && c.userId === 'u' })
  h.cache.activate(h.context)
  h.box = createOutbox({ context: h.context, storage, locks: { request: async (_key, run) => run() }, debounceMs: 60000, yieldControl: async () => {}, send: async (batch) => ({ sent: batch }) })
  const request = { contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands: [] }
  h.cache.saveWarehouseSnapshot(h.context, request, { contractVersion: 1, requestId: request.requestId, companyId: 'a', snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot', coverage: { complete: true, missingBalanceMeansZero: true, warehouseScope: 'all-company-warehouses', productIds: ['p'] }, warehouses: [{ id: 'A', active: true }, { id: 'B', active: true }], balances: [{ warehouseId: 'A', productId: 'p', qtyBase: '40' }, { warehouseId: 'B', productId: 'p', qtyBase: '60' }], totals: [{ productId: 'p', qtyBase: '100' }], commands: [] })
  state = { cloud: true, authAccountId: 'u', companyId: 'a', authUserId: 'u', products: [{ id: 'p', name: 'Product', unit: 'шт', stock: 100, batches: [] }], documents: [], movements: [], moneyTx: [], customers: [], suppliers: [], shifts: [], audit: [], purchaseOrders: [], logAction: vi.fn() }
  Object.assign(state, createDocumentsSlice((value) => { state = { ...state, ...(typeof value === 'function' ? value(state) : value) } }, () => state))
})
afterEach(() => { h.box.destroy(); vi.unstubAllGlobals() })
const doc = (warehouseId, qty = 30) => ({ type: 'inventory', warehouseId, items: [{ productId: 'p', name: 'Product', unit: 'шт', qty }] })
describe('inventory form -> immutable warehouse command -> local projection', () => {
  it('requires an explicit warehouse and never chooses the first warehouse', async () => {
    expect(await state.addDocument(doc(undefined))).toMatchObject({ ok: false })
    expect(state.documents).toEqual([]); expect(h.box.items()).toEqual([])
  })
  it('preserves warehouseId in the header and HTTP command without generating local ledger facts', async () => {
    await state.addDocument(doc('A'))
    expect(state.documents[0].warehouseId).toBe('A')
    expect(h.box.items()[0].obj).toMatchObject({ warehouseId: 'A', type: 'adjust', items: [{ productId: 'p', qty: 30 }] })
    expect(h.box.items()[0].obj).not.toHaveProperty('supplierId')
    expect(state.products[0].stock).toBe(90)
    expect(state.movements).toEqual([]); expect(state.moneyTx).toEqual([]); expect(state.products[0].batches).toEqual([])
  })
  it('two standalone inventory commands remain immutable and the later count replaces the earlier warehouse count', async () => {
    await state.addDocument(doc('A'))
    const original = JSON.stringify(h.box.items()[0].obj)
    await state.addDocument(doc('A', 25))
    expect(h.box.items()).toHaveLength(2)
    expect(JSON.stringify(h.box.items()[0].obj)).toBe(original)
    expect(state.products[0].stock).toBe(85)
  })
  it('draft posting retains its selected warehouse and refuses legacy drafts without a warehouse', async () => {
    const id = await state.addDocument(doc('B', 50), { post: false })
    expect(h.box.items()).toEqual([])
    await state.postDocument(id)
    expect(h.box.items()[0].obj.warehouseId).toBe('B')
    expect(state.products[0].stock).toBe(90)
    state.documents.push({ id: 'old', type: 'inventory', status: 'draft', items: [] })
    expect(await state.postDocument('old')).toMatchObject({ ok: false })
  })
})
