// ──────────────────────────────────────────────────────────────────────────
//  Партионный учёт (FIFO — first in, first out).
//
//  Каждый приход товара создаёт партию { id, qty, cost, at }. Списание
//  забирает из старейших партий первыми. Взято ровно то количество, что
//  запросили, но реальная себестоимость расхода = сумма (qty_i × cost_i)
//  по потреблённым партиям. Это даёт достоверную оценку COGS без
//  «размывания» дорогих поставок дешёвыми.
//
//  Совместимость: если у товара нет batches (старый persist, до v9),
//  функции возвращают fallback на старое поле cost — вызывающая сторона
//  сама решает, что делать.
// ──────────────────────────────────────────────────────────────────────────
import { uid } from './id'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Есть ли у товара батчи? (false → работаем со старой моделью cost/stock)
export function hasBatches(product) {
  return Array.isArray(product?.batches)
}

// Сумма количеств по батчам — источник истины для остатка.
export function totalStock(batches = []) {
  let s = 0
  for (const b of batches) s += Number(b.qty) || 0
  return round2(s)
}

// Взвешенная себестоимость единицы по оставшимся батчам. Пустой склад
// → 0 (нет данных для оценки).
export function weightedCostFromBatches(batches = []) {
  let qty = 0
  let sum = 0
  for (const b of batches) {
    const q = Number(b.qty) || 0
    if (q <= 0) continue
    qty += q
    sum += q * (Number(b.cost) || 0)
  }
  return qty > 0 ? round2(sum / qty) : 0
}

// Добавить приход: новая партия. Ноль количества — no-op.
// Возвращает { batches: новый_массив, batchId }.
export function addBatch(batches, qty, cost, at = new Date().toISOString()) {
  const q = Number(qty) || 0
  if (q <= 0) return { batches: batches || [], batchId: null }
  const batchId = uid('b')
  return {
    batches: [...(batches || []), { id: batchId, qty: round2(q), cost: Number(cost) || 0, at }],
    batchId,
  }
}

// Списать qty по FIFO. Возвращает:
//  - batches: новый массив (пустые исключены);
//  - taken: сколько реально удалось списать (равно qty, если хватило);
//  - cost: общая себестоимость расхода (для записи COGS в movements);
//  - consumed: детали [{ batchId, qty, cost }] — нужны для отката проводки
//    (см. reverseConsume).
//
// Если совокупного qty в батчах меньше запрошенного, списываем всё, что
// есть, taken<qty. Вызывающая сторона (addDocument) сама блокирует такие
// расходы предпроверкой остатка — но библиотека остаётся устойчива.
export function consumeFIFO(batches, qty) {
  const need = Number(qty) || 0
  if (need <= 0) return { batches: batches || [], taken: 0, cost: 0, consumed: [] }
  // Стабильно сортируем по at (первый пришёл — первый ушёл). Сортируем
  // копию, чтобы не мутировать вход.
  const sorted = [...(batches || [])].sort((a, b) =>
    (a.at || '').localeCompare(b.at || ''),
  )
  const consumed = []
  let left = need
  const remaining = []
  for (const b of sorted) {
    const have = Number(b.qty) || 0
    if (left <= 0 || have <= 0) {
      if (have > 0) remaining.push(b)
      continue
    }
    const take = Math.min(have, left)
    consumed.push({ batchId: b.id, qty: round2(take), cost: Number(b.cost) || 0 })
    left = round2(left - take)
    const leftInBatch = round2(have - take)
    if (leftInBatch > 0) remaining.push({ ...b, qty: leftInBatch })
  }
  const taken = round2(need - left)
  const cost = round2(
    consumed.reduce((s, c) => s + c.qty * c.cost, 0),
  )
  return { batches: remaining, taken, cost, consumed }
}

// Обратная операция для отмены проводки: возвращает потреблённые ранее
// количества обратно в соответствующие партии (либо создаёт партию с тем
// же id, если она была полностью съедена). Порядок остаётся стабильным.
export function reverseConsume(batches, consumed) {
  if (!consumed?.length) return batches || []
  const byId = new Map((batches || []).map((b) => [b.id, { ...b }]))
  for (const c of consumed) {
    const existing = byId.get(c.batchId)
    if (existing) {
      existing.qty = round2((Number(existing.qty) || 0) + (Number(c.qty) || 0))
    } else {
      byId.set(c.batchId, {
        id: c.batchId,
        qty: round2(Number(c.qty) || 0),
        cost: Number(c.cost) || 0,
        at: c.at || new Date(0).toISOString(),
      })
    }
  }
  return Array.from(byId.values())
}
