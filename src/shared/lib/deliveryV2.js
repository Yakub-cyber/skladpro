import { canonicalPayload } from './outbox'
export async function deliveryFingerprint(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayload(value)))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}
export async function verifyDeliveryResponse(envelope, body, companyId, key) {
  const { orderId, request } = envelope
  const fingerprint = await deliveryFingerprint({ companyId, orderId, ...request })
  return key === `delivered:${request.shipmentId}` && body?.ok === true && body.contractVersion === 2 &&
    body.commandId === key && body.shipmentId === request.shipmentId && body.documentId === `shipment-${request.shipmentId}` &&
    body.order?.id === orderId && body.order.status === 'delivered' && /^[1-9]\d{0,18}$/.test(body.order.rowVersion) &&
    typeof body.deliveredAt === 'string' && Number.isFinite(Date.parse(body.deliveredAt)) && body.fingerprint === fingerprint
}
export function projectDeliveryHeaders(rows, commands) {
  const pending = new Map(commands.filter(op => !op._acknowledged).map(op => [op.obj.orderId, op]))
  return rows.map(row => {
    const op = pending.get(row.id)
    return !op ? row : { ...row, deliveryPending: { commandId: op.id, code: op._quarantineReason?.code,
      error: op._quarantineReason?.error, needsReview: !!op._quarantined } }
  })
}
