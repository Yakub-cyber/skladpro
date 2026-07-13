import { describe, it, expect } from 'vitest'
import {
  totalStock,
  weightedCostFromBatches,
  addBatch,
  consumeFIFO,
  reverseConsume,
  hasBatches,
} from './batches'

const b = (qty, cost, at) => ({ id: `b_${at || Math.random()}`, qty, cost, at })

describe('totalStock', () => {
  it('сумма количеств по батчам', () => {
    expect(totalStock([b(10, 100, '1'), b(5, 200, '2')])).toBe(15)
  })
  it('пустой массив → 0', () => {
    expect(totalStock([])).toBe(0)
    expect(totalStock()).toBe(0)
  })
})

describe('weightedCostFromBatches', () => {
  it('корректная взвешенная средняя по остатку', () => {
    // 10 по 100 + 10 по 200 → 150
    expect(weightedCostFromBatches([b(10, 100, '1'), b(10, 200, '2')])).toBe(150)
  })
  it('нулевой остаток → 0 (нет данных)', () => {
    expect(weightedCostFromBatches([b(0, 100, '1')])).toBe(0)
  })
})

describe('addBatch', () => {
  it('добавляет партию с id, возвращает batchId', () => {
    const { batches, batchId } = addBatch([], 10, 100, '2026-07-14T10:00:00Z')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({ qty: 10, cost: 100, at: '2026-07-14T10:00:00Z' })
    expect(batchId).toBeTruthy()
    expect(batches[0].id).toBe(batchId)
  })
  it('нулевое qty → no-op', () => {
    const before = [b(5, 100, '1')]
    const { batches, batchId } = addBatch(before, 0, 200)
    expect(batches).toEqual(before)
    expect(batchId).toBeNull()
  })
})

describe('consumeFIFO — списание по FIFO', () => {
  it('целиком из первой партии', () => {
    const r = consumeFIFO([b(10, 100, '1'), b(10, 200, '2')], 5)
    expect(r.taken).toBe(5)
    expect(r.cost).toBe(5 * 100)
    // остаток: 5 по 100, 10 по 200
    expect(r.batches.map((x) => x.qty)).toEqual([5, 10])
    expect(r.consumed).toHaveLength(1)
    expect(r.consumed[0].qty).toBe(5)
    expect(r.consumed[0].cost).toBe(100)
  })

  it('через несколько партий: 10 из первой + 5 из второй', () => {
    const r = consumeFIFO([b(10, 100, '1'), b(10, 200, '2')], 15)
    expect(r.taken).toBe(15)
    // 10*100 + 5*200 = 2000
    expect(r.cost).toBe(2000)
    // остаток: 5 по 200
    expect(r.batches).toHaveLength(1)
    expect(r.batches[0]).toMatchObject({ qty: 5, cost: 200 })
    expect(r.consumed).toHaveLength(2)
  })

  it('порядок независим от исходного массива — сортируем по at', () => {
    // подадим в обратном порядке
    const r = consumeFIFO([b(10, 200, '2026-01-02'), b(10, 100, '2026-01-01')], 15)
    // сначала должна уйти партия от 01-01 (100)
    expect(r.cost).toBe(10 * 100 + 5 * 200)
  })

  it('нехватка: taken < qty, cost — только по фактически списанному', () => {
    const r = consumeFIFO([b(3, 100, '1')], 10)
    expect(r.taken).toBe(3)
    expect(r.cost).toBe(300)
    expect(r.batches).toEqual([])
  })

  it('пустые партии в результате исключаются', () => {
    const r = consumeFIFO([b(5, 100, '1'), b(5, 200, '2')], 5)
    expect(r.batches).toHaveLength(1)
    expect(r.batches[0].qty).toBe(5)
    expect(r.batches[0].cost).toBe(200)
  })
})

describe('reverseConsume — возврат при откате проводки', () => {
  it('восстанавливает потреблённые количества в те же партии', () => {
    const initial = [b(10, 100, '1'), b(10, 200, '2')]
    const r = consumeFIFO(initial, 15)
    // r.batches: [{qty: 5, cost: 200, at: '2'}]
    const restored = reverseConsume(r.batches, r.consumed)
    // partition-1 восстановилась, partition-2 = 10
    const byCost = Object.fromEntries(restored.map((x) => [x.cost, x.qty]))
    expect(byCost[100]).toBe(10)
    expect(byCost[200]).toBe(10)
  })

  it('если партию списали полностью — восстанавливаем с тем же batchId', () => {
    const initial = [b(5, 100, '1')]
    const r = consumeFIFO(initial, 5)
    expect(r.batches).toEqual([])
    const restored = reverseConsume(r.batches, r.consumed)
    expect(restored).toHaveLength(1)
    expect(restored[0].qty).toBe(5)
    expect(restored[0].cost).toBe(100)
    expect(restored[0].id).toBe(r.consumed[0].batchId)
  })

  it('пустой consumed — no-op', () => {
    const before = [b(3, 50, '1')]
    expect(reverseConsume(before, [])).toBe(before)
    expect(reverseConsume(before, null)).toBe(before)
  })
})

describe('hasBatches', () => {
  it('только массив считается наличием батчей', () => {
    expect(hasBatches({ batches: [] })).toBe(true)
    expect(hasBatches({ batches: [b(1, 1, '1')] })).toBe(true)
    expect(hasBatches({})).toBe(false)
    expect(hasBatches({ batches: null })).toBe(false)
    expect(hasBatches(null)).toBe(false)
  })
})
