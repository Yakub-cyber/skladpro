import { isShipmentV2 } from './shipmentV2'
import { saleSign } from './orders'
import { hasConfirmedReturn } from './offlineRefunds'
import { canonicalPayload } from './outbox'
import { commandResources } from './outboxDependencies'
import { validateWarehouseSnapshot } from './warehouseSnapshot'
import { isSaleV2, saleOrder, saleKey } from './saleV2'

// These fields belong to the server warehouse projection, never to catalogue LWW.
export const STOCK_FIELDS = ['stock', 'batches', 'cost', 'rowVersion', 'confirmedStock', 'pendingStockDelta', 'warehouseProjection']
export function warehouseCommandRequest(op) {
  const p = op.obj
  if (op.key === 'order_cancel') return { commandId: op.id, kind: 'order_cancel', orderId: p.orderId, idempotencyKey: op.idempotencyKey, payload: p.request }
  return { commandId: op.id, kind: op.key, idempotencyKey: op.key === 'sale' ? saleKey(op) : op.key === 'doc_post' ? `doc-${op.id}` :
    isShipmentV2(p) ? op.idempotencyKey : op.key === 'return_v2' ? `return:${op.id}` : `ost-${p.orderId}-${p.status}`, payload: op.key === 'return_v2' ? p.request : p }
}
export const warehouseCommandIdentity = (op) => canonicalPayload(warehouseCommandRequest(op))

export function projectWarehouseStocks(record, commands, context) {
  const result = new Map()
  if (!record || record.userId !== context.userId || record.companyId !== context.companyId) return result
  const snapshot = validateWarehouseSnapshot(record.snapshot, record.request, context.companyId)
  const saved = record.projectionContext
  const observed = new Set(saved?.observed || [])
  const covered = new Map((saved?.covered || []).map((c) => [c.entryId, c.identity]))
  const requested = new Map(record.request.commands.map((c) => [JSON.stringify([c.kind, c.commandId]), c]))
  const resolutions = new Map(snapshot.commands.map((c) => [c.commandId, c]))
  for (const total of snapshot.totals) result.set(total.productId, { available: true, snapshotId: snapshot.snapshotId,
    confirmedTotal: Number(total.qtyBase), total: Number(total.qtyBase), warehouses: Object.fromEntries(snapshot.warehouses.map((w) => [w.id, { confirmed: 0, projected: 0 }])) })
  for (const row of snapshot.balances) {
    const pair = result.get(row.productId).warehouses[row.warehouseId]
    pair.confirmed = Number(row.qtyBase); pair.projected = Number(row.qtyBase)
  }
  const sorted = [...commands].sort((a, b) => a._order - b._order || a._entryId.localeCompare(b._entryId))
  for (const op of sorted) {
    if (op.userId !== context.userId || op.companyId !== context.companyId) throw new Error('CONTEXT_CHANGED')
    const resource = commandResources(op)
    if (!resource.stock) continue
    const affected = resource.products.length ? resource.products.filter((p) => result.has(p)) : [...result.keys()]
    if (!affected.length) continue
    const identity = warehouseCommandIdentity(op), query = requested.get(JSON.stringify([op.key, op.id]))
    const matches = query && canonicalPayload(query) === identity
    const resolution = matches ? resolutions.get(op.id) : null
    // A durable transport receipt captured BEFORE this atomic read proves inclusion,
    // even for legacy document contracts without a permanent server fingerprint.
    if (op.key !== 'order_cancel' && !isShipmentV2(op.obj) && !(op.key === 'sale' && isSaleV2(op.obj)) && covered.get(op._entryId) === identity && matches) continue
    if (matches && ['applied', 'reversed'].includes(resolution?.resolution)) continue
    let reason = op.key === 'order_cancel' ? 'CANCELLATION_PENDING_RECONCILIATION' : null
    if (op._quarantined) reason = op._quarantineReason?.code || 'QUARANTINE'
    else if (matches && ['unverifiable', 'conflict'].includes(resolution?.resolution)) reason = resolution.resolution
    else if (!matches && (!saved || observed.has(op._entryId))) reason = 'COMMAND_NOT_RECONCILED'
    else if (!resource.warehouses.length) reason = 'WAREHOUSE_UNKNOWN'
    else if (resource.warehouses.some((w) => !snapshot.warehouses.some((s) => s.id === w))) reason = 'WAREHOUSE_NOT_IN_SNAPSHOT'
    if (!reason && affected.some((p) => !result.get(p).available)) reason = 'DEPENDENCY_UNRESOLVED'
    if (reason) { for (const p of affected) Object.assign(result.get(p), { available: false, reason }); continue }
    const sale = op.key === 'sale' && isSaleV2(op.obj)
    const shipment = isShipmentV2(op.obj)
    const doc = shipment ? { ...op.obj.orderSnapshot, warehouseId: op.obj.warehouseId } : sale ? op.obj.order : op.obj
    const sign = sale || shipment ? -1 : { receive: 1, purchase: 1, stockin: 1, writeoff: -1, supplier_return: -1 }[doc.type]
    for (const item of doc.items || []) {
      const value = result.get(item.productId)
      if (!value?.available) continue
      const inputQty = sale ? Math.round(Number(item.qty) * 10000) / 10000 : Number(item.qty)
      const qty = shipment ? Number(item.qtyBase) : Math.round(inputQty * Number(item.unitFactor ?? 1) * 10000) / 10000
      if (!Number.isFinite(qty) || qty < 0) { Object.assign(value, { available: false, reason: 'QUANTITY_INVALID' }); continue }
      const pair = value.warehouses[doc.warehouseId]
      const round = (n) => Math.round(n * 10000) / 10000
      if (doc.type === 'adjust' || doc.type === 'inventory') pair.projected = qty
      else if (doc.type === 'transfer') {
        pair.projected = round(pair.projected - qty)
        const to = value.warehouses[doc.warehouseToId]; to.projected = round(to.projected + qty)
      } else if (sign != null) pair.projected = round(pair.projected + sign * qty)
      else Object.assign(value, { available: false, reason: 'COMMAND_UNSUPPORTED' })
    }
  }
  for (const value of result.values()) {
    value.total = value.available ? Math.round(Object.values(value.warehouses).reduce((n, p) => n + p.projected, 0) * 10000) / 10000 : null
    if (!value.available) for (const pair of Object.values(value.warehouses)) pair.projected = null
  }
  return result
}
export function mergeProduct(local, server) {
  const result = { ...server, ...local }
  for (const key of STOCK_FIELDS) {
    if (key in server) result[key] = server[key]
    else delete result[key]
  }
  return result
}

export function projectStocks(snapshot, commands) {
  const stocks = new Map(snapshot.products.filter((p) => Number.isFinite(Number(p.stock))).map((p) => [p.id, Number(p.stock)]))
  const orders = new Map(snapshot.orders.map((o) => [o.id, o]))
  const serverOrderIds = new Set(orders.keys())
  // Catalogue revisions may follow their status command; index their item
  // identities first without trusting their optimistic status as confirmation.
  for (const op of commands) if (op.key === 'orders' && op.op !== 'delete' && !orders.has(op.id)) {
    orders.set(op.id, { ...op.obj, status: 'new', stockConsumed: false })
  }
  const documents = new Set(snapshot.documents)
  const covered = new Set(snapshot.covered)
  const addItems = (items, sign) => {
    for (const item of items || []) if (stocks.has(item.productId)) {
      const qty = Math.round((Number(item.qty) || 0) * (Number(item.unitFactor) || 1) * 10000) / 10000
      stocks.set(item.productId, stocks.get(item.productId) + sign * qty)
    }
  }
  for (const op of commands) {
    if (covered.has(op._entryId)) continue
    if (op.key === 'sale') {
      // Sale-v2 stock is projected exclusively against the warehouse snapshot.
      if (isSaleV2(op.obj)) continue
      // A lost response is not a second sale: the server header proves application.
      if (serverOrderIds.has(op.id)) continue
      const order = { ...saleOrder(op.obj), status: 'delivered', stockConsumed: true }
      addItems(order.items, -saleSign(order)); orders.set(op.id, order)
    } else if (op.key === 'return_v2') {
      if (hasConfirmedReturn(orders.get(op.obj.request.orderId), op.id)) continue
      for (const item of op.obj.projection.items) if (stocks.has(item.productId)) {
        stocks.set(item.productId, stocks.get(item.productId) + Number(item.qtyBase))
      }
    } else if (op.key === 'order_status' && !isShipmentV2(op.obj)) {
      const before = orders.get(op.obj.orderId)
      if (!before || before.status === op.obj.status) continue
      const after = { ...before, status: op.obj.status, stockConsumed: ['shipped', 'delivered'].includes(op.obj.status) }
      addItems(before.items, saleSign(before) - saleSign(after)); orders.set(before.id, after)
    } else if (op.key === 'doc_post' && !documents.has(op.id)) {
      const doc = op.obj
      const sign = { purchase: 1, stockin: 1, receive: 1, sale_return: 1, return: 1,
        writeoff: -1, supplier_return: -1, sale: -1, ship: -1 }[doc.type]
      if (sign != null) addItems(doc.items, sign)
      else if (doc.type === 'inventory' || doc.type === 'adjust') {
        // An inventory is warehouse-scoped. Only projectWarehouseStocks may apply it.
      }
      // Transfers do not change company-wide stock. No financial rows are replayed.
      documents.add(op.id)
    }
  }
  return new Map(snapshot.products.map((product) => {
    const confirmedStock = Number(product.stock), stock = stocks.get(product.id)
    return [product.id, stock == null ? product : { ...product, confirmedStock, pendingStockDelta: stock - confirmedStock, stock }]
  }))
}
