import { planRefund } from './refunds'

export function prepareOfflineRefund(order, orders, opts = {}) {
  const planned = planRefund(order, orders, opts.items)
  if (!planned.ok) throw new Error(planned.error)
  const returnId = globalThis.crypto.randomUUID()
  const items = planned.items.map((item) => {
    const source = order.items.find((line) => line.saleLineId === item.saleLineId)
    if (!source?.saleLineId || !(Number(source.qtyBase) > 0)) {
      throw new Error('Нет подтверждённых строк продажи. Загрузите чек онлайн перед возвратом.')
    }
    const qty = Number(item.qty) * Number(source.qtyBase) / Number(source.qty)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000 || Math.abs(qty * 10000 - Math.round(qty * 10000)) > 1e-6) {
      throw new Error('Количество возврата должно иметь не более четырёх знаков в базовой единице')
    }
    return { saleLineId: source.saleLineId, qtyBase: qty.toFixed(4) }
  }).sort((a, b) => a.saleLineId.localeCompare(b.saleLineId))
  const request = { contractVersion: 2, returnId, orderId: order.id, items, reason: opts.reason || 'Возврат покупателя' }
  const projection = { createdAt: new Date().toISOString(), estimatedTotal: planned.total,
    items: planned.items.map((item) => ({ productId: item.productId, name: item.name, qty: item.qty,
      saleLineId: item.saleLineId, qtyBase: items.find((line) => line.saleLineId === item.saleLineId).qtyBase })) }
  return { id: returnId, command: { request, projection } }
}

export function hasConfirmedReturn(order, returnId) {
  return (order?.returns || []).some((event) => event.contractVersion === 2 && event.returnId === returnId &&
    event.documentId === `ret-${returnId}` && event.orderId === order.id)
}

// Headers are a view of durable commands / server history. They are never a money fact
// and never a second order sent through sync/push.
export function projectReturnHeaders(data, commands) {
  const orders = (data.orders || []).filter((order) => order.refundContractVersion !== 2)
  const headers = new Map()
  for (const order of orders) for (const event of order.returns || []) {
    if (!hasConfirmedReturn({ ...order, returns: [event] }, event.returnId)) continue
    headers.set(event.returnId, { id: `return-${event.returnId}`, returnId: event.returnId, refundContractVersion: 2,
      kind: 'refund', origOrderId: order.id, no: `Возврат ${order.no || order.id}`, status: 'delivered',
      refundState: 'confirmed', stockConsumed: false, createdAt: event.at, items: event.items || [],
      total: Number(event.amountMinor) / 100, serverResult: event })
    const header = headers.get(event.returnId)
    header.items = header.items.map((item) => {
      const source = order.items?.find((line) => line.saleLineId === item.saleLineId)
      const qty = source ? Number(item.qtyBase) * Number(source.qty) / Number(source.qtyBase) : Number(item.qtyBase)
      return { ...item, name: source?.name || item.productId, unit: source?.unit, qty,
        price: qty > 0 ? Number(item.amountMinor) / 100 / qty : 0 }
    })
  }
  for (const op of commands) {
    if (op.key !== 'return_v2' || headers.has(op.id)) continue
    const { request, projection } = op.obj
    const order = orders.find((row) => row.id === request.orderId)
    headers.set(op.id, { id: `return-${op.id}`, returnId: op.id, refundContractVersion: 2,
      kind: 'refund', origOrderId: request.orderId, no: `Возврат ${order?.no || request.orderId}`,
      status: 'pending', refundState: op._quarantined ? 'review' : 'pending', stockConsumed: false,
      createdAt: projection.createdAt, items: projection.items, total: 0, estimatedTotal: projection.estimatedTotal,
      syncError: op._quarantineReason?.error || null })
  }
  return { ...data, orders: [...headers.values(), ...orders] }
}
