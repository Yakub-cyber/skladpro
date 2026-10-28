import { canonicalPayload } from './outbox'
import { validCommercial } from './commercialOrders'
export const isShipmentV2 = p => p?.contractVersion === 2 && p.status === 'shipped' && !!p.orderSnapshot
const scaled = (v, n) => { const [a, b = ''] = v.split('.'); return BigInt(a) * 10n ** BigInt(n) + BigInt(b.padEnd(n, '0')) }
export function shipmentConditions(c) {
  if (!validCommercial(c) || !c.onCredit || !c.customerId || c.customerId === 'retail' || c.payment.method !== 'credit') return 'Доступна только неоплаченная кредитная отгрузка реальному клиенту'
  if (scaled(c.discount.value, 2) !== 0n || scaled(c.total, 2) <= 0n) return 'Отгрузка со скидкой или нулевой суммой пока недоступна'
  let sum = 0n
  for (const line of c.items) {
    const amount = scaled(line.qtyBase, 4) * scaled(line.price, 2)
    if (line.markCodes?.length || amount % 10000n) return 'Маркировка или округление строк требуют отдельного проведения'
    sum += amount / 10000n
  }
  return sum === scaled(c.total, 2) ? null : 'Округление итога не поддерживается для отгрузки'
}
export async function verifyShipmentResponse(orderId, payload, body, companyId) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayload({ companyId, orderId, ...payload })))
  const fingerprint = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
  const documentId = `shipment-${payload.shipmentId}`
  return body?.ok === true && body.contractVersion === 2 && body.order?.id === orderId && body.order.status === 'shipped' &&
    body.shipmentId === payload.shipmentId && body.documentId === documentId && body.warehouseId === payload.warehouseId && body.fingerprint === fingerprint &&
    body.cashReceivedMinor === '0' && scaled(body.amount, 2) === scaled(payload.orderSnapshot.total, 2) && body.debtCreatedMinor === String(scaled(body.amount, 2)) &&
    Array.isArray(body.items) && body.items.length === payload.orderSnapshot.items.length && new Set(body.items.map(l => l.sourceLineId)).size === body.items.length &&
    payload.orderSnapshot.items.every(l => body.items.some(r => r.sourceLineId === l.lineId && r.documentLineId === `${documentId}:${l.lineId}` && r.saleLineId === r.documentLineId && r.productId === l.productId && r.qtyBase === l.qtyBase))
}
export function projectShipmentHeaders(rows, commands) {
  const byOrder = new Map(commands.filter(op => isShipmentV2(op.obj)).map(op => [op.id, op]))
  return rows.map(row => {
    const op = byOrder.get(row.id)
    if (!op) return row
    if (op._acknowledged) return { ...row, shipmentWarehouseId: op.obj.warehouseId, shipmentQueued: true }
    return { ...row, shipmentPending: { shipmentId: op.obj.shipmentId, warehouseId: op.obj.warehouseId,
      error: op._quarantineReason?.error, code: op._quarantineReason?.code }, shipmentQueued: true }
  })
}
