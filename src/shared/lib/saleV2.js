export const isSaleV2 = (payload) => payload?.contractVersion === 2 && !!payload.order
export const saleOrder = (payload) => isSaleV2(payload) ? payload.order : payload
export const saleKey = (op) => isSaleV2(op.obj) && op.idempotencyKey ? op.idempotencyKey : `sale-${op.id}`
export const saleWarehouseError = (warehouses, warehouseId) => !warehouseId ? 'Выберите склад продажи'
  : !warehouses?.some((w) => w.id === warehouseId && !w.deletedAt && !w.deleted_at && w.active !== false && !w.archived)
    ? 'Склад недоступен для новой продажи' : null

// Same recursive canonicalization/defaults as backend salesV2.ts. No mutation of
// the durable HTTP envelope is allowed, even for request normalization.
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
    : JSON.stringify(value)
export async function verifySaleResponse(payload, body, companyId) {
  const order = payload.order
  const request = { contractVersion: 2, companyId, order: { ...order, discount: order.discount ?? 0, onCredit: order.onCredit ?? false } }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(request)))
  const fingerprint = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('')
  const round = (v) => Math.round(v * 10000) / 10000
  const items = order.items.map((i) => ({ ...i, qty: round(i.qty) })).sort((a, b) => a.productId.localeCompare(b.productId))
  return body?.ok === true && body.contractVersion === 2 && body.order?.id === order.id &&
    body.documentId === `sale-${order.id}` && body.warehouseId === order.warehouseId && body.fingerprint === fingerprint &&
    Array.isArray(body.items) && body.items.length === items.length && items.every((i, n) =>
      body.items[n]?.saleLineId === `sale-${order.id}-${n}` && body.items[n].productId === i.productId &&
      body.items[n].qtyBase === round(i.qty * (i.unitFactor ?? 1)).toFixed(4))
}
