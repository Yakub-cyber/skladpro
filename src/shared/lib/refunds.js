const cents = (n) => Math.round(Number(n) * 100)

export function priorRefunds(order, orders = []) {
  return orders.filter(
    (o) => o.kind === 'refund' && o.origOrderId === order.id && o.status !== 'cancelled',
  )
}

export function remainingRefundItems(order, orders = []) {
  const previous = priorRefunds(order, orders)
  return (order.items || []).map((it) => {
    const returned = previous.reduce(
      (n, r) =>
        n +
        (r.items || [])
          .filter((x) => x.productId === it.productId)
          .reduce((sum, x) => sum + Number(x.qty), 0),
      0,
    )
    return { ...it, qty: Math.max(0, Number(it.qty) - returned), returned }
  })
}

// Общий расчёт для формы и учётного движка: деньги считаются от оплаченной
// суммы, количество — от ещё не возвращённого, а партии — от исходной продажи.
export function planRefund(order, orders = [], requested) {
  const remaining = remainingRefundItems(order, orders)
  const source = requested === undefined ? remaining.filter((it) => it.qty > 0) : requested
  const quantities = new Map()
  for (const it of source || []) {
    const qty = Number(it.qty)
    if (!Number.isFinite(qty) || qty <= 0)
      return { ok: false, error: 'Количество возврата должно быть положительным числом' }
    quantities.set(it.productId, (quantities.get(it.productId) || 0) + qty)
  }
  if (!quantities.size) return { ok: false, error: 'Все товары по этому чеку уже возвращены' }
  const gross = (order.items || []).reduce((n, it) => n + Number(it.qty) * Number(it.price || 0), 0)
  const ratio = gross > 0 ? Number(order.total) / gross : 0
  const items = []
  for (const [productId, qty] of quantities) {
    const original = (order.items || []).filter((it) => it.productId === productId)
    if (!original.length) return { ok: false, error: `Товар ${productId} не из этого чека` }
    if (original.length > 1)
      return { ok: false, error: 'В чеке повторяются позиции товара — требуется разбор возврата' }
    const left = remaining.find((it) => it.productId === productId)
    if (qty > left.qty + 1e-9)
      return {
        ok: false,
        error: `Возвращают ${qty}, осталось ${left.qty} по «${left.name || productId}» — больше нельзя`,
      }
    const oi = original[0]
    let skip = left.returned
    let take = qty
    const consumed = []
    for (const c of oi.consumed || []) {
      const skipped = Math.min(skip, Number(c.qty))
      skip -= skipped
      const part = Math.min(take, Number(c.qty) - skipped)
      if (part > 0) consumed.push({ ...c, qty: part })
      take -= part
    }
    items.push({
      ...oi,
      qty,
      price: Number(oi.price || 0) * ratio,
      consumed,
      codes: oi.codes?.slice(left.returned, left.returned + qty),
    })
  }
  const previous = priorRefunds(order, orders)
  const paidLeft = Math.max(
    0,
    cents(order.total) - previous.reduce((n, r) => n + cents(r.total), 0),
  )
  const completes = remaining.every((it) => it.qty <= (quantities.get(it.productId) || 0) + 1e-9)
  const amount = completes
    ? paidLeft
    : Math.min(paidLeft, cents(items.reduce((n, it) => n + it.qty * it.price, 0)))
  return { ok: true, items, total: amount / 100 }
}
