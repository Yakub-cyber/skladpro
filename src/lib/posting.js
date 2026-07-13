// ──────────────────────────────────────────────────────────────────────────
//  Движок проводки складских документов.
//  Чистая функция: получает состояние ({ products, movements }) и документ,
//  возвращает НОВОЕ частичное состояние. Не зависит от стора — легко тестировать.
//
//  Партионный учёт (FIFO): если у товара есть массив `batches`, приход
//  добавляет партию, а расход списывает из старейших первыми и записывает
//  реальную себестоимость в movement.cost. Товары без batches (legacy до
//  persist v9) работают по старой модели: cost как средневзвешенная.
// ──────────────────────────────────────────────────────────────────────────
import { uid } from './id'
import { docTypeInfo } from './constants'
import { weightedCost } from './cost'
import {
  addBatch,
  consumeFIFO,
  reverseConsume,
  totalStock,
  weightedCostFromBatches,
  hasBatches,
} from './batches'

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
        // Партионный: инвентаризация — не FIFO, а корректировка. Излишек
        // → отдельная партия по текущей средней; недостача → FIFO-списание.
        // Записываем это в это же поле it.invAdjust для отката.
        if (hasBatches(p)) {
          let batches = p.batches
          if (dir > 0) {
            if (delta > 0) {
              const currentCost = weightedCostFromBatches(batches) || Number(p.cost) || 0
              const r = addBatch(batches, delta, currentCost, at)
              batches = r.batches
              it.invAdjust = { type: 'add', batchId: r.batchId }
            } else if (delta < 0) {
              const r = consumeFIFO(batches, -delta)
              batches = r.batches
              it.invAdjust = { type: 'consume', consumed: r.consumed }
            }
          } else {
            // Откат: восстанавливаем противоположное. Если при проведении
            // добавили батч — удаляем его; если списали по FIFO — возвращаем.
            const adj = it.invAdjust
            if (adj?.type === 'add') {
              batches = batches.filter((b) => b.id !== adj.batchId)
            } else if (adj?.type === 'consume') {
              batches = reverseConsume(batches, adj.consumed)
            }
          }
          return {
            ...p,
            batches,
            stock: totalStock(batches),
            cost: weightedCostFromBatches(batches) || p.cost || 0,
          }
        }
        return { ...p, stock: Math.max(0, target) }
      })
      if (delta !== 0)
        moves.push({ id: uid('mv'), type: 'inventory', productId: it.productId, name: it.name, qty: Math.abs(delta), delta, reason: dir < 0 ? reason : delta > 0 ? 'Излишек' : 'Недостача', by, at })
    }
  } else {
    const sign = (POST_SIGN[doc.type] ?? -1) * dir
    const mvType = POST_MV[doc.type] || 'writeoff'
    const isPurchase = doc.type === 'purchase'
    const isSaleReturn = doc.type === 'sale_return'
    for (const it of doc.items) {
      let mvCost = null // фактическая себестоимость расхода (для COGS)
      setP(it.productId, (p) => {
        // ── Партионная ветка ────────────────────────────────────────────
        if (hasBatches(p)) {
          let batches = p.batches
          if (dir > 0) {
            if (isPurchase) {
              // Приход: новая партия по цене прихода (или по текущей средней).
              const cost = it.cost != null && it.cost !== '' ? Number(it.cost) : weightedCostFromBatches(batches) || Number(p.cost) || 0
              const r = addBatch(batches, it.qty, cost, at)
              batches = r.batches
              it.batchId = r.batchId // для отката
            } else if (isSaleReturn) {
              // Возврат от клиента: возвращаем в новую партию по текущей средней
              // (себестоимость возврата = текущая средняя, иначе последняя cost).
              const cost = weightedCostFromBatches(batches) || Number(p.cost) || 0
              const r = addBatch(batches, it.qty, cost, at)
              batches = r.batches
              it.batchId = r.batchId
            } else {
              // Расход по FIFO: sale / writeoff / supplier_return
              const r = consumeFIFO(batches, it.qty)
              batches = r.batches
              mvCost = r.cost
              it.consumed = r.consumed // для отката
            }
          } else {
            // Откат dir=-1: удалить добавленную партию или восстановить FIFO.
            if ((isPurchase || isSaleReturn) && it.batchId) {
              batches = batches.filter((b) => b.id !== it.batchId)
            } else if (it.consumed) {
              batches = reverseConsume(batches, it.consumed)
            }
          }
          return {
            ...p,
            batches,
            stock: totalStock(batches),
            cost: weightedCostFromBatches(batches) || p.cost || 0,
          }
        }
        // ── Legacy без batches: старая логика ─────────────────────────
        const d = sign * it.qty
        const np = { ...p, stock: Math.max(0, p.stock + d) }
        if (isPurchase && it.cost != null) {
          if (dir > 0) {
            it.prevCost = p.cost
            np.cost = weightedCost(p.stock, p.cost, it.qty, it.cost)
          } else if (it.prevCost != null) {
            np.cost = it.prevCost
          }
        }
        return np
      })
      const d = sign * it.qty
      const mv = { id: uid('mv'), type: mvType, productId: it.productId, name: it.name, qty: it.qty, delta: d, reason, by, at }
      if (mvCost != null) mv.cost = mvCost
      moves.push(mv)
    }
  }
  return { products, movements: [...moves, ...state.movements] }
}
