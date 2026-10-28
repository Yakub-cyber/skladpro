import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createOrdersSlice } from '../store/slices/ordersSlice'
import { createOutbox, safeStorage, canonicalPayload } from './outbox'
import { createScopedCache, emptyCloudData } from './scopedCache'
import { warehouseCommandRequest } from './stockProjection'
import { shipmentConditions, verifyShipmentResponse } from './shipmentV2'
import { commandResources } from './outboxDependencies'
import { prepareCommercial } from './commercialOrders'

const h = vi.hoisted(() => ({ ctx: { userId: 'u', companyId: 'a', generation: 1 }, cache: null, box: null }))
vi.mock('@/shared/api', () => ({ hasApi: true, getAuthContext: () => ({ ...h.ctx }), isAuthContextCurrent: c => JSON.stringify(c) === JSON.stringify(h.ctx) }))
vi.mock('./cloud', () => ({ prepareProtectedShipment: vi.fn(), enqueueShipment: (id, obj) => h.box.enqueueCommand({ ...h.ctx, op: 'update', key: 'order_status', id, idempotencyKey: `shipment:${obj.shipmentId}`, obj }), enqueueSale: vi.fn(), enqueueReturn: vi.fn(), enqueueOrderStatus: vi.fn(),
  enqueueCommercialOrder: (key, obj) => h.box.enqueueCommand({ ...h.ctx, op: key === 'commercial_create' ? 'create' : 'update', key, id: obj.commandId, idempotencyKey: `commercial:${obj.commandId}`, obj }) }))
vi.mock('./scopedCache', async original => ({ ...await original(), companyCache: {
  overlayLocal: (ctx, state) => h.cache.overlayLocal(ctx, state), error: () => h.cache.error(), pendingOrderCommands: (ctx, id) => h.cache.pendingOrderCommands(ctx, id), commercialOrder: (ctx, id) => h.cache.commercialOrder(ctx, id),
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
beforeEach(() => {
  vi.stubGlobal('sessionStorage', safeStorage()); h.ctx = { userId: 'u', companyId: 'a', generation: 1 }; boxes = []; storage = safeStorage()
  const tails = new Map(); locks = { request: (key, run) => { const p = (tails.get(key) || Promise.resolve()).then(run); tails.set(key, p.catch(() => {})); return p } }
  store = { ...emptyCloudData(), cloud: true, products: [{ id: 'p', name: 'Product', unit: 'шт', stock: 100, serverUnits: [{ id: 'unit', name: 'шт', factor: '1', isBase: true }] }], warehouses: [{ id: 'A' }, { id: 'B' }, { id: 'old', active: false }], customers: [{ id: 'c', balance: 50 }], logAction: vi.fn() }
  const get = () => store, set = patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) } }
  store = { ...store, ...createOrdersSlice(set, get) }; reload(); h.box = makeBox()
  const c = prepareCommercial({ ...input(), onCredit: true }, store.products, null, () => 'line')
  h.cache.saveCommercialOrder(h.ctx, { id: 'order', rowVersion: '20', commercialSnapshot: c, status: 'picking' }); reload(); snapshot()
})
afterEach(() => { boxes.forEach(b => b.destroy()); vi.unstubAllGlobals() })


function snapshot(ops = [], resolution = 'not_observed', a = 40) {
 const request = { contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands: ops.map(warehouseCommandRequest) }
 h.cache.saveWarehouseSnapshot(h.ctx, request, { contractVersion: 1, companyId: h.ctx.companyId, requestId: request.requestId, snapshotId: crypto.randomUUID(), consistency: 'transaction-snapshot',
 coverage: { productIds: ['p'], warehouseScope: 'all-company-warehouses', complete: true, missingBalanceMeansZero: true }, warehouses: [{ id: 'A', active: true }, { id: 'B', active: true }],
 balances: [{ productId: 'p', warehouseId: 'A', qtyBase: String(a) }, { productId: 'p', warehouseId: 'B', qtyBase: '60' }], totals: [{ productId: 'p', qtyBase: String(a + 60) }],
 commands: ops.map(op => ({ commandId: op.id, resolution, effectIncluded: resolution === 'applied' ? true : resolution === 'not_observed' ? false : null, documentId: resolution === 'applied' ? `shipment-${op.obj.shipmentId}` : null, reason: 'TEST' })) })
}
describe('shipment v2 durable frontend', () => {
 it.each(['A','B'])('ships warehouse %s with an exact immutable HTTP envelope and no money/debt effects', async warehouse => {
   const before = JSON.stringify([store.customers,store.moneyTx,store.movements]); expect((await store.shipOrder('order',warehouse)).ok).toBe(true)
   const op = h.box.items()[0]; expect(op).toMatchObject({ key:'order_status',id:'order',idempotencyKey:`shipment:${op.obj.shipmentId}` }); expect(op.obj).not.toHaveProperty('orderId')
   expect(warehouseCommandRequest(op)).toMatchObject({ commandId:'order',payload:op.obj,idempotencyKey:op.idempotencyKey })
   expect(commandResources(op)).toMatchObject({ orderId:'order',products:['p'],warehouses:[warehouse] })
   expect(h.cache.warehouseProjection(h.ctx).get('p').warehouses[warehouse].projected).toBe(warehouse==='A'?38:58)
   const saved=JSON.stringify(op.obj); reload(); h.box=makeBox(); expect(JSON.stringify(h.box.items()[0].obj)).toBe(saved); expect(store.orders[0].shipmentPending.shipmentId).toBe(op.obj.shipmentId)
   expect(JSON.stringify([store.customers,store.moneyTx,store.movements])).toBe(before)
 })
 it.each(['','old','foreign'])('rejects unavailable warehouse %s',async warehouse=>{expect((await store.shipOrder('order',warehouse)).ok).toBe(false);expect(h.box.items()).toEqual([])})
 it('requires a protected confirmed prepared order and blocks financial ambiguity',async()=>{
   expect((await store.shipOrder('historical','A')).ok).toBe(false)
   const c=store.orders[0].commercialSnapshot; expect(shipmentConditions({...c,onCredit:false})).toBeTruthy();expect(shipmentConditions({...c,discount:{kind:'percent',value:'1'}})).toBeTruthy()
   h.cache.saveCommercialOrder(h.ctx,{id:'order',rowVersion:'21',commercialSnapshot:c,status:'new'});reload();expect((await store.shipOrder('order','A')).ok).toBe(false)
 })
 it('does not overlay applied twice, and refuses conflict/unverifiable/STALE',async()=>{
   await store.shipOrder('order','A');const ops=h.box.items();snapshot(ops,'applied',38);expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
   for(const resolution of ['conflict','unverifiable']){snapshot(ops,resolution,38);expect(h.cache.warehouseProjection(h.ctx).get('p').available).toBe(false);expect(h.box.items()).toHaveLength(1)}
   snapshot(ops);expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
   storage.setItem(`sklad.outbox.v2.u:a.meta.${ops[0]._entryId}`,JSON.stringify({_quarantined:true,_quarantineReason:{code:'STALE'}}));expect(h.cache.warehouseProjection(h.ctx).get('p').available).toBe(false)
 })
 it('prohibits edits, another shipment and direct delivered once queued',async()=>{
   await store.shipOrder('order','A');const before=JSON.stringify(store.products)
   expect((await store.updateOrder('order',input(),{expectedRowVersion:'20',baseSnapshot:store.orders[0].commercialSnapshot})).ok).toBe(false)
   expect((await store.shipOrder('order','B')).ok).toBe(false);expect(store.setOrderStatus('order','delivered').ok).toBe(false);expect(JSON.stringify(store.products)).toBe(before)
 })
 it('delivered cannot deduct an already confirmed shipment again',async()=>{
   await store.shipOrder('order','A');const op=h.box.items()[0]
   h.cache.saveCommercialOrder(h.ctx,{id:'order',rowVersion:'30',commercialSnapshot:op.obj.orderSnapshot,status:'shipped',stockConsumed:true,shipmentDocId:`shipment-${op.obj.shipmentId}`})
   storage.setItem(`sklad.outbox.v2.u:a.ack.${op._entryId}`,'confirmed');snapshot([op],'applied',38);reload()
   expect(store.setOrderStatus('order','delivered').ok).toBe(false);expect(h.cache.warehouseProjection(h.ctx).get('p').total).toBe(98)
   expect(store.orders[0].status).toBe('shipped')
 })
 it('does not accept shipment through pending commercial changes',async()=>{
   await h.box.enqueueCommand({...h.ctx,key:'commercial_edit',op:'update',id:'edit',obj:{orderId:'order',commandId:'edit',commercial:store.orders[0].commercialSnapshot,expectedRowVersion:'20'}})
   expect((await store.shipOrder('order','A')).ok).toBe(false)
 })
 it('storage failure preserves the same intended shipment identity across reload and retry',async()=>{
   const write=storage.setItem.bind(storage);let fail=true;storage.setItem=(k,v)=>{if(fail&&k.includes('.op.'))throw Error('quota');write(k,v)}
   expect((await store.shipOrder('order','A')).ok).toBe(false);expect(store.orders[0].shipmentPending).toBeUndefined();const intent=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)));reload();fail=false
   expect((await store.shipOrder('order','A')).ok).toBe(true);expect(h.box.items()[0].obj).toEqual(intent.prepared.body)
 })
 it('two tabs cannot replace a saved shipment; lost response retry uses the same key/body',async()=>{
   const calls=[];let lost=true;h.box=makeBox(async batch=>{calls.push(batch.map(op=>[op.obj,op.idempotencyKey]));if(lost){lost=false;throw Error('lost')}return {sent:batch}})
   await store.shipOrder('order','A');const op=h.box.items()[0],peer=makeBox();expect(await peer.enqueueCommand(op)).toMatchObject({ok:true,duplicate:true});expect(await peer.enqueueCommand({...op,obj:{...op.obj,warehouseId:'B'}})).toMatchObject({ok:false,code:'COMMAND_CONFLICT'})
   await h.box.flushNow();await h.box.flushNow();expect(calls[0]).toEqual(calls[1])
 })
 it('retains dependency barriers and ownership after reload, company switch and logout',async()=>{
   await store.shipOrder('order','A');const op=h.box.items()[0];await h.box.enqueueCommand({...h.ctx,key:'doc_post',op:'create',id:'later',obj:{type:'adjust',warehouseId:'A',items:[{productId:'p',qty:25}]}})
   storage.setItem(`sklad.outbox.v2.u:a.meta.${op._entryId}`,JSON.stringify({_quarantined:true,_quarantineReason:{code:'STALE'}}));const send=vi.fn();const peer=makeBox(send);await peer.flushNow();expect(send).not.toHaveBeenCalled()
   h.ctx={...h.ctx,companyId:'b',generation:2};peer.setContext(h.ctx);reload();expect(store.orders).toHaveLength(0);expect(peer.items()).toHaveLength(0)
   h.ctx={userId:null,companyId:null,generation:3};expect((await store.shipOrder('order','A')).ok).toBe(false)
 })
 it('verifies persistent shipment identity, mapped source lines and zero received cash',async()=>{
   await store.shipOrder('order','A');const op=h.box.items()[0],p=op.obj,documentId=`shipment-${p.shipmentId}`
   const body={ok:true,contractVersion:2,order:{id:'order',status:'shipped'},shipmentId:p.shipmentId,documentId,warehouseId:'A',amount:'100.00',cashReceivedMinor:'0',debtCreatedMinor:'10000',fingerprint:createHash('sha256').update(canonicalPayload({companyId:'a',orderId:'order',...p})).digest('hex'),items:p.orderSnapshot.items.map(l=>({sourceLineId:l.lineId,documentLineId:`${documentId}:${l.lineId}`,saleLineId:`${documentId}:${l.lineId}`,productId:l.productId,qtyBase:l.qtyBase}))}
   expect(await verifyShipmentResponse('order',p,body,'a')).toBe(true);expect(await verifyShipmentResponse('order',p,{...body,cashReceivedMinor:'1'},'a')).toBe(false)
 })
})
