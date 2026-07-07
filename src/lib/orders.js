// ──────────────────────────────────────────────────────────────────────────
//  Влияние заказа на остатки, коды маркировки и долг контрагента.
//  Чистая функция — симметрична: создание резервирует, отмена возвращает.
//  dir = -1 — резерв при создании (списываем со склада),
//  dir = +1 — возврат при отмене (возвращаем на склад).
//  Возвращает { products, customers, order }, где order — с записанными в
//  позициях выбывшими кодами маркировки (чтобы отмена могла их восстановить).
// ──────────────────────────────────────────────────────────────────────────
export function applyOrderStock(state, order, dir) {
  const items = (order.items || []).map((it) => ({ ...it }))
  const products = state.products.map((p) => {
    const it = items.find((x) => x.productId === p.id)
    if (!it) return p
    const np = { ...p, stock: Math.max(0, p.stock + dir * it.qty) }
    if (p.marked) {
      if (dir < 0) {
        // резерв: первые ceil(qty) кодов выбывают — запоминаем их в позиции
        if (p.codes?.length) {
          const n = Math.ceil(it.qty)
          it.codes = p.codes.slice(0, n)
          np.codes = p.codes.slice(n)
        }
      } else if (dir > 0 && it.codes?.length) {
        // возврат: восстанавливаем ранее выбывшие коды (без дублей)
        np.codes = [...new Set([...(p.codes || []), ...it.codes])]
      }
    }
    return np
  })

  // Заказ «в долг»: создание увеличивает задолженность, отмена — уменьшает.
  let customers = state.customers
  if (order.onCredit && order.customerId) {
    customers = state.customers.map((c) =>
      c.id === order.customerId
        ? { ...c, balance: Math.max(0, (c.balance || 0) - dir * order.total) }
        : c,
    )
  }

  return { products, customers, order: { ...order, items } }
}
