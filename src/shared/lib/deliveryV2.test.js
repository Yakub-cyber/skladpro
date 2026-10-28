import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { createOutbox, safeStorage } from './outbox'
import { createScopedCache, emptyCloudData } from './scopedCache'
import { warehouseCommandRequest } from './stockProjection'
import { deliveryFingerprint, verifyDeliveryResponse } from './deliveryV2'
import { commandResources } from './outboxDependencies'
import { prepareCommercial } from './commercialOrders'

const h = vi.hoisted(() => ({ ctx: { userId: 'u', companyId: 'a', generation: 1 }, cache: null, box: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.ctx }), isAuthContextCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }))
vi.mock('./cloud', () => ({ enqueueDelivery: obj => h.box.enqueueCommand({ ...h.ctx, key: 'order_delivery', op: 'update', id: `delivered:${obj.request.shipmentId}`, idempotencyKey: `delivered:${obj.request.shipmentId}`, obj }), prepareProtectedShipment: vi.fn(), enqueueShipment: (id, obj) => h.box.enqueueCommand({ ...h.ctx, op: 'update', key: 'order_status', id, idempotencyKey: `shipment:${obj.shipmentId}`, obj }), enqueueSale: vi.fn(), enqueueReturn: vi.fn(), enqueueOrderStatus: vi.fn(),
  enqueueCommercialOrder: (key, obj) => h.box.enqueueCommand({ ...h.ctx, op: key === 'commercial_create' ? 'create' : 'update', key, id: obj.commandId, idempotencyKey: `commercial:${obj.commandId}`, obj }) }))
vi.mock('./scopedCache', async original => ({ ...await original(), companyCache: {
  overlayLocal: (ctx, state) => h.cache.overlayLocal(ctx, state), error: () => h.cache.error(), deliverySource: (ctx,id) => h.cache.deliverySource(ctx,id), pendingOrderCommands: (ctx, id) => h.cache.pendingOrderCommands(ctx, id), commercialOrder: (ctx, id) => h.cache.commercialOrder(ctx, id),
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
beforeEach(async () => {
  vi.stubGlobal('sessionStorage', safeStorage()); h.ctx = { userId: 'u', companyId: 'a', generation: 1 }; boxes = []; storage = safeStorage()
  const tails = new Map(); locks = { request: (key, run) => { const p = (tails.get(key) || Promise.resolve()).then(run); tails.set(key, p.catch(() => {})); return p } }
  store = { ...emptyCloudData(), cloud: true, products: [{ id: 'p', name: 'Product', unit: 'шт', stock: 100, serverUnits: [{ id: 'unit', name: 'шт', factor: '1', isBase: true }] }], warehouses: [{ id: 'A' }, { id: 'B' }, { id: 'old', active: false }], customers: [{ id: 'c', balance: 50 }], logAction: vi.fn() }
  const get = () => store, set = patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) } }
  store = { ...store, ...createOrdersSlice(set, get) }; reload(); h.box = makeBox()
  const c = prepareCommercial({ ...input(), onCredit: true }, store.products, null, () => 'line')
  h.cache.saveCommercialOrder(h.ctx, { id: 'order', rowVersion: '20', commercialSnapshot: c, status: 'picking' }); reload(); snapshot()
  await store.shipOrder('order','A'); const op = h.box.items()[0]
  h.cache.saveCommercialOrder(h.ctx, { id: 'order', rowVersion: '30', commercialSnapshot: op.obj.orderSnapshot, status: 'shipped', stockConsumed: true, shipmentDocId: `shipment-${op.obj.shipmentId}` })
  storage.setItem(`sklad.outbox.v2.u:a.ack.${op._entryId}`, 'confirmed'); snapshot([op], 'applied', 38); reload()
})
afterEach(() => { boxes.forEach(b => b.destroy()); vi.unstubAllGlobals() })


function snapshot(ops = [], resolution = 'not_observed', a = 40) {
 const request = { contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands: ops.map(warehouseCommandRequest) }
 h.cache.saveWarehouseSnapshot(h.ctx, request, { contractVersion: 1, companyId: h.ctx.companyId, requestId: request.requestId, snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot',
 coverage: { productIds: ['p'], warehouseScope: 'all-company-warehouses', complete: true, missingBalanceMeansZero: true }, warehouses: [{ id: 'A', active: true }, { id: 'B', active: true }],
 balances: [{ productId: 'p', warehouseId: 'A', qtyBase: String(a) }, { productId: 'p', warehouseId: 'B', qtyBase: '60' }], totals: [{ productId: 'p', qtyBase: String(a + 60) }],
 commands: ops.map(op => ({ commandId: op.id, resolution, effectIncluded: resolution === 'applied' ? true : resolution === 'not_observed' ? false : null, documentId: resolution === 'applied' ? `shipment-${op.obj.shipmentId}` : null, reason: 'TEST' })) })
}
describe('delivered v2 durable frontend', () => {
 it('uses the original applied shipment identity, keeps status pending and changes no stock, money or debt',async()=>{
  const before=JSON.stringify([store.products,store.customers,store.moneyTx,store.movements]), source=h.cache.deliverySource(h.ctx,'order')
  expect((await store.deliverOrder('order')).ok).toBe(true)
  const op=h.box.items().find(o=>o.key==='order_delivery');expect(op).toMatchObject({id:`delivered:${source.shipmentId}`,idempotencyKey:`delivered:${source.shipmentId}`})
  expect(op.obj.request).toEqual({contractVersion:2,status:'delivered',shipmentId:source.shipmentId,shipmentFingerprint:await deliveryFingerprint({companyId:'a',orderId:'order',...source.payload})})
  expect(commandResources(op)).toMatchObject({stock:false,orderId:'order',scope:'order'});expect(store.orders[0].status).toBe('shipped');expect(store.orders[0].deliveryPending.commandId).toBe(op.id)
  expect(JSON.stringify([store.products,store.customers,store.moneyTx,store.movements])).toBe(before);expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
  const saved=JSON.stringify(op.obj);reload();h.box=makeBox();expect(JSON.stringify(h.box.items()[0].obj)).toBe(saved);expect(store.orders[0].deliveryPending).toBeTruthy()
 })
 it('cannot bypass through legacy status, migrate historical orders or deliver before shipment confirmation',async()=>{
  expect(store.setOrderStatus('order','delivered').ok).toBe(false)
  expect((await store.deliverOrder('legacy')).ok).toBe(false)
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)),ack=keys.find(k=>k.includes('.ack.'));storage.removeItem(ack)
  expect((await store.deliverOrder('order')).ok).toBe(false);expect(h.box.items().filter(o=>o.key==='order_delivery')).toEqual([])
 })
 it.each(['not_observed','unverifiable','conflict'])('does not accept shipment %s as a delivery source',async resolution=>{
  const ops=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(k=>k.includes('.op.')).map(k=>JSON.parse(storage.getItem(k))).filter(op=>op.key==='order_status');snapshot(ops,resolution,38)
  expect((await store.deliverOrder('order')).ok).toBe(false)
 })
 it('rejects a changed reconcile request, absent snapshot and source quarantine',async()=>{
  const key=Array.from({length:storage.length},(_,i)=>storage.key(i)).find(k=>k.endsWith('warehouseSnapshot.v1')),record=storage.getItem(key)
  storage.removeItem(key);expect((await store.deliverOrder('order')).ok).toBe(false);storage.setItem(key,record)
  const data=JSON.parse(record);data.request.commands[0].payload.warehouseId='B';storage.setItem(key,JSON.stringify(data));expect((await store.deliverOrder('order')).ok).toBe(false);storage.setItem(key,record)
  const op=JSON.parse(storage.getItem(Array.from({length:storage.length},(_,i)=>storage.key(i)).find(k=>k.includes('.op.'))));storage.setItem(`sklad.outbox.v2.u:a.meta.${op._entryId}`,JSON.stringify({_quarantined:true,_quarantineReason:{code:'STALE'}}));expect((await store.deliverOrder('order')).ok).toBe(false)
 })
 it('storage refusal reports failure and a reload retry preserves the exact reserved envelope',async()=>{
  const write=storage.setItem.bind(storage);let fail=true;storage.setItem=(k,v)=>{if(fail&&k.includes('.op.'))throw Error('quota');write(k,v)}
  const before=JSON.stringify(store.orders);expect((await store.deliverOrder('order')).ok).toBe(false);expect(JSON.stringify(store.orders)).toBe(before)
  const intent=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)));reload();fail=false
  expect((await store.deliverOrder('order')).ok).toBe(true);expect(h.box.items().find(o=>o.key==='order_delivery').obj).toEqual(intent.prepared.envelope)
 })
 it('two tabs accept an identical repeat and reject changed content with the same identity',async()=>{
  await store.deliverOrder('order');const op=h.box.items()[0],peer=makeBox();expect(await peer.enqueueCommand(op)).toMatchObject({ok:true,duplicate:true})
  expect(await peer.enqueueCommand({...op,obj:{...op.obj,request:{...op.obj.request,shipmentFingerprint:'0'.repeat(64)}}})).toMatchObject({ok:false,code:'COMMAND_CONFLICT'})
  expect((await store.deliverOrder('order')).ok).toBe(false)
 })
 it('lost response sends the same HTTP envelope/key again without another local effect',async()=>{
  const calls=[];let lost=true;h.box=makeBox(async batch=>{calls.push(batch.map(op=>[op.idempotencyKey,op.obj]));if(lost){lost=false;throw Error('lost after commit')}return {sent:batch}})
  const before=JSON.stringify([store.products,store.customers,store.moneyTx]);await store.deliverOrder('order');await h.box.flushNow();await h.box.flushNow();expect(calls[0]).toEqual(calls[1]);expect(JSON.stringify([store.products,store.customers,store.moneyTx])).toBe(before)
 })
 it('respects same-order commercial dependency and preserves old scope after company switch/logout',async()=>{
  await h.box.enqueueCommand({...h.ctx,op:'update',key:'commercial_edit',id:'blocked',obj:{orderId:'order',commercial:store.orders[0].commercialSnapshot,expectedRowVersion:'30'}})
  expect((await store.deliverOrder('order')).ok).toBe(false)
  h.ctx={...h.ctx,companyId:'b',generation:2};h.box.setContext(h.ctx);reload();expect((await store.deliverOrder('order')).ok).toBe(false);expect(h.box.items()).toHaveLength(0)
  h.ctx={userId:null,companyId:null,generation:3};expect((await store.deliverOrder('order')).ok).toBe(false)
 })
 it('does not overwrite current cancellation/delivery with a pending command or an old receipt',async()=>{
  await store.deliverOrder('order');const op=h.box.items()[0],snapshot=store.orders[0].commercialSnapshot
  h.cache.saveCommercialOrder(h.ctx,{id:'order',rowVersion:'40',commercialSnapshot:snapshot,status:'cancelled',stockConsumed:false,shipmentDocId:`shipment-${op.obj.request.shipmentId}`});reload();expect(store.orders[0].status).toBe('cancelled');expect(store.orders[0].deliveryPending).toBeTruthy()
  storage.setItem(`sklad.outbox.v2.u:a.ack.${op._entryId}`,'confirmed');reload();expect(store.orders[0].status).toBe('cancelled');expect(store.orders[0].deliveryPending).toBeUndefined()
 })
 it('validates permanent delivery result identity and rejects a response from another company',async()=>{
  await store.deliverOrder('order');const op=h.box.items()[0],p=op.obj
  const body={ok:true,contractVersion:2,commandId:op.id,order:{id:'order',status:'delivered',rowVersion:'40'},shipmentId:p.request.shipmentId,documentId:`shipment-${p.request.shipmentId}`,deliveredAt:new Date().toISOString(),fingerprint:await deliveryFingerprint({companyId:'a',orderId:p.orderId,...p.request})}
  expect(await verifyDeliveryResponse(p,body,'a',op.idempotencyKey)).toBe(true);expect(await verifyDeliveryResponse(p,body,'b',op.idempotencyKey)).toBe(false)
 })
})
