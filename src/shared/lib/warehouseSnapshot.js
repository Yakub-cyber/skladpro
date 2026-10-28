// This contract is deliberately independent of product stock projection and outbox acknowledgements.
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }) }
const id = (v, max = 128) => typeof v === 'string' && v.length > 0 && v.length <= max
const uuid = (v) => typeof v === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v)
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length
const exact = (actual, expected) => actual.length === expected.length && new Set(actual).size === actual.length && actual.every((v) => expected.includes(v))
const copy = (v) => JSON.parse(JSON.stringify(v))
const kinds = new Set(['sale', 'doc_post', 'order_status', 'return_v2', 'order_cancel'])
const effects = { applied: true, reversed: false, not_observed: false, conflict: null, unverifiable: null }

export function validateStockRequest(request) {
  if (!object(request) || request.contractVersion !== 1 || !uuid(request.requestId) ||
    !Array.isArray(request.productIds) || !request.productIds.length || request.productIds.length > 500 ||
    !request.productIds.every((p) => id(p)) || new Set(request.productIds).size !== request.productIds.length ||
    !Array.isArray(request.commands) || request.commands.length > 500 ||
    new Set(request.commands.map((c) => c?.commandId)).size !== request.commands.length ||
    request.commands.some((c) => !object(c) || !id(c.commandId) || !id(c.idempotencyKey, 200) || !kinds.has(c.kind) || !object(c.payload)) ||
    bytes(request) > 256 * 1024) fail('STOCK_REQUEST_INVALID')
  if (Object.keys(request).some((k) => !['contractVersion', 'requestId', 'productIds', 'commands'].includes(k)) ||
    request.commands.some((c) => Object.keys(c).some((k) => ![...['commandId', 'kind', 'idempotencyKey', 'payload'], ...(c.kind === 'order_cancel' ? ['orderId'] : [])].includes(k)))) fail('STOCK_REQUEST_INVALID')
  for (const c of request.commands.filter(c => c.kind === 'order_cancel')) {
    const p = c.payload
    if (!id(c.orderId, 64) || !/^[\w:.-]+$/.test(c.orderId) || p.contractVersion !== 2 || p.status !== 'cancelled' ||
      !uuid(p.shipmentId) || p.shipmentId !== p.shipmentId.toLowerCase() || (typeof p.shipmentFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(p.shipmentFingerprint)) ||
      Object.keys(p).some(k => !['contractVersion', 'status', 'shipmentId', 'shipmentFingerprint'].includes(k)) ||
      c.commandId !== `cancelled:${p.shipmentId}` || c.idempotencyKey !== c.commandId) fail('STOCK_REQUEST_INVALID')
  }
  return request
}

function units(value) {
  if (typeof value !== 'string' || !/^-?\d{1,30}(\.\d{1,4})?$/.test(value)) fail('STOCK_SNAPSHOT_INVALID')
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n)
}

export function validateWarehouseSnapshot(snapshot, request, companyId) {
  validateStockRequest(request)
  const invalid = () => fail('STOCK_SNAPSHOT_INVALID')
  if (!object(snapshot) || snapshot.contractVersion !== 1 || snapshot.companyId !== companyId ||
    snapshot.requestId !== request.requestId || !uuid(snapshot.snapshotId) || snapshot.consistency !== 'transaction-snapshot' ||
    snapshot.coverage?.complete !== true || snapshot.coverage?.missingBalanceMeansZero !== true ||
    snapshot.coverage?.warehouseScope !== 'all-company-warehouses' || !Array.isArray(snapshot.coverage.productIds) ||
    !exact(snapshot.coverage.productIds, request.productIds) || bytes(snapshot) > 4 * 1024 * 1024) invalid()
  for (const field of ['warehouses', 'balances', 'totals', 'commands']) if (!Array.isArray(snapshot[field]) || snapshot[field].length > 20000) invalid()
  const warehouses = new Set(), pairs = new Set(), sums = new Map(request.productIds.map((p) => [p, 0n]))
  for (const wh of snapshot.warehouses) {
    if (!object(wh) || !id(wh.id) || typeof wh.active !== 'boolean' || warehouses.has(wh.id)) invalid()
    warehouses.add(wh.id)
  }
  for (const row of snapshot.balances) {
    if (!object(row) || !sums.has(row.productId) || !warehouses.has(row.warehouseId)) invalid()
    const pair = JSON.stringify([row.warehouseId, row.productId])
    if (pairs.has(pair)) invalid()
    pairs.add(pair); sums.set(row.productId, sums.get(row.productId) + units(row.qtyBase))
  }
  if (!exact(snapshot.totals.map((r) => r?.productId), request.productIds)) invalid()
  for (const row of snapshot.totals) if (units(row.qtyBase) !== sums.get(row.productId)) invalid()
  if (!exact(snapshot.commands.map((c) => c?.commandId), request.commands.map((c) => c.commandId))) invalid()
  for (const command of snapshot.commands) {
    if (!object(command) || !Object.hasOwn(effects, command.resolution) || command.effectIncluded !== effects[command.resolution] ||
      !(command.documentId === null || id(command.documentId)) || !id(command.reason, 500) ||
      (['applied', 'reversed'].includes(command.resolution) && !id(command.documentId))) invalid()
  }
  for (const c of request.commands.filter(c => c.kind === 'order_cancel')) {
    const cancellation = snapshot.commands.find(r => r.commandId === c.commandId)
    const shipment = request.commands.find(r => r.kind === 'order_status' && r.commandId === c.orderId && r.payload.shipmentId === c.payload.shipmentId)
    if (cancellation.resolution === 'applied' && cancellation.documentId !== `shipment-${c.payload.shipmentId}`) invalid()
    if (shipment && cancellation.resolution === 'applied') {
      const original = snapshot.commands.find(r => r.commandId === shipment.commandId)
      if (original.resolution !== 'reversed' || original.documentId !== cancellation.documentId || cancellation.documentId !== `shipment-${c.payload.shipmentId}`) invalid()
    }
  }
  return copy(snapshot)
}

export function createWarehouseReconciler({ fetchSnapshot, cache, getContext, isCurrent, newId = () => crypto.randomUUID() }) {
  let sequence = 0
  return async ({ productIds, commands = [] }, context = getContext()) => {
    const ticket = ++sequence, owner = { ...context }
    if (!owner.userId || !owner.companyId || !isCurrent(owner)) fail('CONTEXT_CHANGED')
    const request = copy({ contractVersion: 1, requestId: newId(), productIds, commands })
    validateStockRequest(request)
    const beforeRead = cache.prepareWarehouseSnapshot?.(owner)
    const response = await fetchSnapshot(request, owner)
    // Latest-started request wins in this coordinator; snapshotId has no ordering meaning.
    if (!isCurrent(owner)) fail('CONTEXT_CHANGED')
    if (ticket !== sequence) fail('STOCK_REQUEST_SUPERSEDED')
    if (!response.ok) fail(response.error?.code || 'STOCK_RECONCILE_FAILED', response.error?.message)
    const snapshot = validateWarehouseSnapshot(response.body, request, owner.companyId)
    if (!isCurrent(owner) || ticket !== sequence) fail('CONTEXT_CHANGED')
    cache.saveWarehouseSnapshot(owner, request, snapshot, beforeRead)
    return snapshot
  }
}
