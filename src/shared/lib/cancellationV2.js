import { deliveryFingerprint } from './deliveryV2'
export const isCancellation = op => op.key === 'order_cancel'
export async function verifyCancellationResponse(envelope, body, companyId, key) {
  const { orderId, request } = envelope
  const fingerprint = await deliveryFingerprint({ companyId, orderId, ...request })
  return key === `cancelled:${request.shipmentId}` && body?.ok === true && body.contractVersion === 2 &&
    body.commandId === key && body.fingerprint === fingerprint && body.shipmentId === request.shipmentId &&
    body.shipmentFingerprint === request.shipmentFingerprint && body.documentId === `shipment-${request.shipmentId}` &&
    body.documentStatus === 'void' && body.order?.id === orderId && body.order.status === 'cancelled' &&
    /^[1-9]\d{0,18}$/.test(body.order.rowVersion) && body.cashRefundedMinor === '0' &&
    typeof body.cancelledAt === 'string' && Number.isFinite(Date.parse(body.cancelledAt))
}
export function projectCancellationHeaders(rows, commands) {
  const pending = new Map(commands.filter(op => !op._acknowledged).map(op => [op.obj.orderId, op]))
  return rows.map(row => {
    const op = pending.get(row.id)
    return !op ? row : { ...row, cancellationPending: { commandId: op.id, code: op._quarantineReason?.code,
      error: op._quarantineReason?.error, needsReview: !!op._quarantined } }
  })
}
