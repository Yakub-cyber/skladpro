// ──────────────────────────────────────────────────────────────────────────
//  Движок проводки складских документов.
//  Чистая функция: получает состояние ({ products, movements }) и документ,
//  возвращает НОВОЕ частичное состояние. Не зависит от стора — легко тестировать.
// ──────────────────────────────────────────────────────────────────────────
import { uid } from './id'
import { docTypeInfo } from './constants'
import { weightedCost } from './cost'

// Тип движения и знак влияния на остаток при проводке (post).
export const POST_MV = {
  purchase: 'in',
  sale_return: 'return',
  writeoff: 'writeoff',
  supplier_return: 'supplier_return',
  sale: 'writeoff',
}
export const POST_SIGN = {
  purchase: 1,
  sale_return: 1,
  writeoff: -1,
  supplier_return: -1,
  sale: -1,
}

// Применить документ к остаткам и журналу движений.
// dir=1 — провести, -1 — откатить (отмена проводки).
// Возвращает part state ({ products, movements }) для set().
export function applyDocToState(state, doc, dir, by) {
  const at = new Date().toISOString()
  const moves = []
  let products = state.products
  const setP = (id, fn) => {
    products = products.map((p) => (p.id === id ? fn(p) : p))
  }
  const reason =
    dir < 0 ? `Отмена · ${doc.no}` : doc.reason || docTypeInfo(doc.type).label

  if (doc.type === 'transfer') {
    for (const it of doc.items) {
      const to = dir > 0 ? doc.toWarehouseId : it.fromWh
      setP(it.productId, (p) => ({ ...p, warehouseId: to || p.warehouseId }))
      moves.push({ id: uid('mv'), type: 'transfer', productId: it.productId, name: it.name, qty: it.qty, delta: 0, reason, by, at })
    }
  } else if (doc.type === 'inventory') {
    for (const it of doc.items) {
      const target = dir > 0 ? it.qty : it.prevStock
      let delta = 0
      setP(it.productId, (p) => {
        delta = target - p.stock
        return { ...p, stock: Math.max(0, target) }
      })
      if (delta !== 0)
        moves.push({ id: uid('mv'), type: 'inventory', productId: it.productId, name: it.name, qty: Math.abs(delta), delta, reason: dir < 0 ? reason : delta > 0 ? 'Излишек' : 'Недостача', by, at })
    }
  } else {
    const sign = (POST_SIGN[doc.type] ?? -1) * dir
    const mvType = POST_MV[doc.type] || 'writeoff'
    const isPurchase = doc.type === 'purchase'
    for (const it of doc.items) {
      const d = sign * it.qty
      setP(it.productId, (p) => {
        const np = { ...p, stock: Math.max(0, p.stock + d) }
        // Приход обновляет себестоимость (средневзвешенную), если задана цена.
        if (isPurchase && it.cost != null) {
          if (dir > 0) {
            it.prevCost = p.cost // запоминаем для отката проводки
            np.cost = weightedCost(p.stock, p.cost, it.qty, it.cost)
          } else if (it.prevCost != null) {
            np.cost = it.prevCost // откат: возвращаем прежнюю себестоимость
          }
        }
        return np
      })
      moves.push({ id: uid('mv'), type: mvType, productId: it.productId, name: it.name, qty: it.qty, delta: d, reason, by, at })
    }
  }
  return { products, movements: [...moves, ...state.movements] }
}
