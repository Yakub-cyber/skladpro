import { isShipmentV2 } from './shipmentV2'
export const isBusinessCommand = (op) => ['sale', 'doc_post', 'return_v2', 'order_status', 'commercial_create', 'commercial_edit', 'order_delivery', 'order_cancel'].includes(op.key)
import { isSaleV2, saleOrder } from './saleV2'
const id = (value) => typeof value === 'string' && value.length > 0 ? value : null

export function commandResources(op) {
  if (!isBusinessCommand(op)) return { stock: false, products: [], warehouses: [], orderId: null, scope: 'none' }
  if (op.key === 'order_status' && isShipmentV2(op.obj)) {
    const lines = op.obj.orderSnapshot.items
    const complete = Array.isArray(lines) && lines.length > 0 && lines.every(l => id(l?.productId))
    const products = complete ? [...new Set(lines.map(l => l.productId))] : []
    const warehouses = id(op.obj.warehouseId) ? [op.obj.warehouseId] : []
    return { stock: true, products, warehouses, orderId: id(op.id), scope: !complete ? 'company_stock' : !warehouses.length ? 'product_any_warehouse' : 'warehouse_product' }
  }
  const p = (op.key === 'sale' ? saleOrder(op.obj) : op.obj) || {}, orderId = id(op.key === 'sale' ? p.id || op.id : op.key === 'return_v2' ? p.request?.orderId : p.orderId)
  if (op.key === 'order_cancel') {
    const items = p.projection?.items, warehouseId = id(p.projection?.warehouseId)
    const products = Array.isArray(items) && items.length && items.every(l => id(l?.productId)) ? [...new Set(items.map(l => l.productId))] : []
    return { stock: true, products, warehouses: warehouseId ? [warehouseId] : [], orderId,
      scope: !products.length ? 'company_stock' : !warehouseId ? 'product_any_warehouse' : 'warehouse_product' }
  }
  if (op.key === 'order_delivery') return { stock: false, products: [], warehouses: [], orderId, scope: 'order' }
  if (op.key === 'commercial_create' || op.key === 'commercial_edit') return { stock: false, products: [], warehouses: [], orderId, scope: 'order' }
  // These existing status transitions do not post or unpost stock in orders.ts.
  if (op.key === 'order_status' && ['new', 'confirmed', 'picking', 'packed', 'delivered'].includes(p.status)) {
    return { stock: false, products: [], warehouses: [], orderId, scope: 'order' }
  }
  const items = op.key === 'order_status' ? null : op.key === 'return_v2' ? p.projection?.items : p.items
  let complete = Array.isArray(items) && items.length > 0 && items.every((item) => id(item?.productId))
  if (complete && op.key === 'return_v2') {
    const lines = new Map(items.map((item) => [item.saleLineId, item]))
    complete = lines.size === items.length && Array.isArray(p.request?.items) && p.request.items.length === items.length &&
      p.request.items.every((line) => id(line.saleLineId) && lines.has(line.saleLineId) && lines.get(line.saleLineId).qtyBase === line.qtyBase)
  }
  const products = complete ? [...new Set(items.map((item) => item.productId))] : []
  // Returns/statuses do not carry an authoritative warehouse in the current transport contract.
  // Only the explicit sale-v2 contract makes its warehouse authoritative.
  const transfer = op.key === 'doc_post' && p.type === 'transfer'
  const warehouses = (op.key === 'doc_post' || op.key === 'sale' && isSaleV2(op.obj)) && id(p.warehouseId) && (!transfer || id(p.warehouseToId))
    ? [...new Set(transfer ? [p.warehouseId, p.warehouseToId] : [p.warehouseId])] : []
  return { stock: true, products, warehouses, orderId,
    scope: !products.length ? 'company_stock' : !warehouses.length ? 'product_any_warehouse' : 'warehouse_product' }
}

// Immediate-predecessor DAG, not pairwise comparisons. Wildcards collapse frontiers,
// so long chains and company barriers do not cause quadratic journal scans.
export async function buildDependencyPlan(records, { yieldControl = async () => {}, chunkSize = 128 } = {}) {
  const nodes = new Map(), products = new Map(), orders = new Map(), frontier = new Set(), heap = [], blockedNodes = new Map()
  let global = null
  function push(node) {
    if (node.queued || node.attempted || node.op._quarantined || node.parents.size || node.resolved) return
    node.queued = true
    let i = heap.length; heap.push(node)
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].position <= node.position) break; heap[i] = heap[parent]; i = parent }
    heap[i] = node
  }
  function pop() {
    const first = heap[0], last = heap.pop()
    if (heap.length) {
      let i = 0
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1
        if (child + 1 < heap.length && heap[child + 1].position < heap[child].position) child++
        if (heap[child].position >= last.position) break
        heap[i] = heap[child]; i = child
      }
      heap[i] = last
    }
    first.queued = false
    return first
  }
  const edge = (parent, child, scope) => {
    if (!parent || parent === child) return
    child.parents.set(parent.op._entryId, scope); parent.children.add(child.op._entryId)
  }
  for (let position = 0; position < records.length; position++) {
    const op = records[position], resource = commandResources(op)
    const node = { op, resource, position, parents: new Map(), children: new Set(), resolved: false, attempted: false, queued: false }
    nodes.set(op._entryId, node)
    if (resource.orderId) { edge(orders.get(resource.orderId), node, 'order'); orders.set(resource.orderId, node) }
    if (resource.stock) {
      edge(global, node, 'company_stock')
      if (!resource.products.length) {
        for (const parent of frontier) edge(parent, node, 'company_stock')
        frontier.clear(); products.clear(); global = node
      } else for (const product of resource.products) {
        if (!products.has(product)) products.set(product, { wildcard: null, warehouses: new Map() })
        const state = products.get(product)
        edge(state.wildcard, node, 'product_any_warehouse')
        if (!resource.warehouses.length) {
          for (const parent of state.warehouses.values()) edge(parent, node, 'product_any_warehouse')
          state.warehouses.clear(); state.wildcard = node
        } else for (const warehouse of resource.warehouses) {
          edge(state.warehouses.get(warehouse), node, 'warehouse_product'); state.warehouses.set(warehouse, node)
        }
      }
      for (const parentId of node.parents.keys()) frontier.delete(nodes.get(parentId))
      frontier.add(node)
    }
    if (!op._quarantined && node.parents.size) blockedNodes.set(op._entryId, node)
    push(node)
    if ((position + 1) % chunkSize === 0) await yieldControl()
  }
  return {
    hasReady: () => heap.length > 0,
    blockedCount: () => blockedNodes.size,
    take: (limit) => {
      const batch = []
      while (heap.length && batch.length < limit) {
        const node = pop()
        if (node.resolved || node.op._quarantined || node.parents.size) continue
        node.attempted = true; batch.push(node.op)
      }
      return batch
    },
    canSend: (entryId) => { const node = nodes.get(entryId); return !!node && !node.resolved && !node.op._quarantined && !node.parents.size },
    confirm: (entryId) => {
      const node = nodes.get(entryId)
      if (!node || node.resolved) return
      node.resolved = true
      blockedNodes.delete(entryId)
      for (const childId of node.children) {
        const child = nodes.get(childId); child.parents.delete(entryId)
        if (!child.parents.size) blockedNodes.delete(childId)
        push(child)
      }
    },
    reject: (entryId, op) => { const node = nodes.get(entryId); if (node) { node.op = op; if (op._quarantined) blockedNodes.delete(entryId) } },
    blocked: (limit = 100) => {
      const result = []
      for (const node of blockedNodes.values()) {
        const [predecessorEntryId, scope] = node.parents.entries().next().value, predecessor = nodes.get(predecessorEntryId).op
        result.push({ id: node.op.id, key: node.op.key, entryId: node.op._entryId, predecessorId: predecessor.id,
          predecessorKey: predecessor.key, predecessorEntryId, scope,
          reason: predecessor._quarantineReason?.code || 'UNCONFIRMED_PREDECESSOR' })
        if (result.length >= limit) break
      }
      return result
    },
  }
}
