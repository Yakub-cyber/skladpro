// ──────────────────────────────────────────────────────────────────────────
//  Резерв и списание остатков по заказам.
//  Модель: заказ РЕЗЕРВИРУЕТ остаток (пока открыт), физическое списание со
//  склада происходит при ОТГРУЗКЕ. Доступно к продаже = остаток − резерв.
//  Долг «в долг» — отдельно (начисляется при создании), здесь только склад.
// ──────────────────────────────────────────────────────────────────────────

// Статусы, в которых заказ держит резерв (ещё не отгружен и не отменён).
export const OPEN_STATUSES = ['new', 'confirmed', 'picking', 'packed']

// Статусы, в которых остаток уже физически списан со склада.
export const CONSUMED_STATUSES = ['shipped', 'delivered']

// Флаг «остаток физически списан» из статуса — для заказов, пришедших без него
// (данные до модели резервирования: из облака или старого persist).
export function stockConsumedFromStatus(status) {
  return CONSUMED_STATUSES.includes(status)
}

// Зарезервировано по товарам: сумма кол-ва в открытых заказах → { productId: qty }.
export function reservedByProduct(orders = []) {
  const map = {}
  for (const o of orders) {
    if (!OPEN_STATUSES.includes(o.status)) continue
    for (const it of o.items || []) {
      map[it.productId] = (map[it.productId] || 0) + (Number(it.qty) || 0)
    }
  }
  return map
}

// Доступно к продаже = физический остаток − резерв.
export function availableStock(product, reservedMap = {}) {
  return (product?.stock || 0) - (reservedMap[product?.id] || 0)
}

// Списание/возврат физического остатка и кодов маркировки.
// dir = -1 — отгрузка (списываем со склада, коды выбывают),
// dir = +1 — возврат при отмене отгруженного заказа.
// Возвращает { products, order } — order с записанными выбывшими кодами
// (чтобы отмена могла их восстановить).
export function applyOrderStock(state, order, dir) {
  const items = (order.items || []).map((it) => ({ ...it }))
  const products = state.products.map((p) => {
    const it = items.find((x) => x.productId === p.id)
    if (!it) return p
    const np = { ...p, stock: Math.max(0, (p.stock || 0) + dir * it.qty) }
    if (p.marked) {
      if (dir < 0) {
        // отгрузка: первые ceil(qty) кодов выбывают — запоминаем их в позиции
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
  return { products, order: { ...order, items } }
}

// Миграция на модель резервирования (persist v7 → v8).
// Старая модель списывала остаток при СОЗДАНИИ заказа (и записывала выбывшие
// коды маркировки в позицию it.codes). Новая — открытый заказ лишь резервирует,
// списание при отгрузке. Поэтому открытым заказам возвращаем на склад остаток
// (его удержит резерв) И коды маркировки (из it.codes обратно в пул, без дублей),
// снимая их с позиции; отгруженным/доставленным ставим stockConsumed=true.
// Чистая и идемпотентная: заказы с уже проставленным stockConsumed пропускаются.
export function migrateReservationV8(state) {
  const giveBack = {} // productId → qty
  const codesBack = {} // productId → [коды]
  const orders = (state.orders || []).map((o) => {
    if (o.stockConsumed != null) return o // уже новая модель
    if (!OPEN_STATUSES.includes(o.status)) {
      return { ...o, stockConsumed: stockConsumedFromStatus(o.status) }
    }
    const items = (o.items || []).map((it) => {
      giveBack[it.productId] = (giveBack[it.productId] || 0) + (Number(it.qty) || 0)
      if (it.codes?.length) {
        codesBack[it.productId] = (codesBack[it.productId] || []).concat(it.codes)
        return { ...it, codes: [] } // коды вернулись в пул — снимаем с позиции
      }
      return it
    })
    return { ...o, items, stockConsumed: false }
  })
  const products = (state.products || []).map((p) => {
    const dq = giveBack[p.id]
    const dc = codesBack[p.id]
    if (!dq && !dc) return p
    const np = { ...p }
    if (dq) np.stock = (p.stock || 0) + dq
    if (dc) np.codes = [...new Set([...(p.codes || []), ...dc])]
    return np
  })
  return { ...state, orders, products }
}
