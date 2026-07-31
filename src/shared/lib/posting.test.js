import { describe, it, expect } from 'vitest'
import { applyDocToState } from './posting'

// Фабрика исходного состояния склада для тестов
const makeState = (overrides = {}) => ({
  products: [
    { id: 'p1', name: 'Гвозди', unit: 'кг', stock: 100, warehouseId: 'wh1' },
    { id: 'p2', name: 'Молоток', unit: 'шт', stock: 10, warehouseId: 'wh1' },
  ],
  movements: [],
  ...overrides,
})

const stockOf = (state, id) => state.products.find((p) => p.id === id).stock
const whOf = (state, id) => state.products.find((p) => p.id === id).warehouseId

describe('applyDocToState — проводка документов', () => {
  it('закупка (purchase) увеличивает остаток', () => {
    const doc = { type: 'purchase', no: 'ЗАК-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 40 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p1')).toBe(140)
    expect(next.movements[0]).toMatchObject({ type: 'in', delta: 40, qty: 40 })
  })

  it('продажа (sale) уменьшает остаток', () => {
    const doc = { type: 'sale', no: 'ПРД-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 30 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p1')).toBe(70)
    expect(next.movements[0]).toMatchObject({ type: 'writeoff', delta: -30 })
  })

  it('возврат от клиента (sale_return) увеличивает остаток', () => {
    const doc = { type: 'sale_return', no: 'ВЗП-1', items: [{ productId: 'p2', name: 'Молоток', qty: 3 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p2')).toBe(13)
    expect(next.movements[0]).toMatchObject({ type: 'return', delta: 3 })
  })

  it('возврат поставщику (supplier_return) уменьшает остаток', () => {
    const doc = { type: 'supplier_return', no: 'ВЗС-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 25 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p1')).toBe(75)
    expect(next.movements[0]).toMatchObject({ type: 'supplier_return', delta: -25 })
  })

  it('списание (writeoff) уменьшает остаток', () => {
    const doc = { type: 'writeoff', no: 'СПС-1', items: [{ productId: 'p2', name: 'Молоток', qty: 4 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p2')).toBe(6)
  })

  it('остаток не уходит в минус (clamp на 0)', () => {
    const doc = { type: 'sale', no: 'ПРД-2', items: [{ productId: 'p2', name: 'Молоток', qty: 999 }] }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p2')).toBe(0)
  })

  it('перемещение (transfer) меняет склад, не трогая общий остаток', () => {
    const doc = {
      type: 'transfer', no: 'ПРМ-1', toWarehouseId: 'wh2',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 100, fromWh: 'wh1' }],
    }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(whOf(next, 'p1')).toBe('wh2')
    expect(stockOf(next, 'p1')).toBe(100) // остаток не изменился
    expect(next.movements[0]).toMatchObject({ type: 'transfer', delta: 0 })
  })

  it('инвентаризация (inventory) выставляет остаток по факту и пишет излишек/недостачу', () => {
    const doc = {
      type: 'inventory', no: 'ИНВ-1',
      items: [
        { productId: 'p1', name: 'Гвозди', qty: 90, prevStock: 100 }, // недостача −10
        { productId: 'p2', name: 'Молоток', qty: 15, prevStock: 10 }, // излишек +5
      ],
    }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(stockOf(next, 'p1')).toBe(90)
    expect(stockOf(next, 'p2')).toBe(15)
    const reasons = next.movements.map((m) => m.reason)
    expect(reasons).toContain('Недостача')
    expect(reasons).toContain('Излишек')
  })

  it('инвентаризация без расхождений не создаёт движений', () => {
    const doc = {
      type: 'inventory', no: 'ИНВ-2',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 100, prevStock: 100 }],
    }
    const next = applyDocToState(makeState(), doc, 1, 'u1')
    expect(next.movements).toHaveLength(0)
  })
})

describe('applyDocToState — откат проводки (dir=-1)', () => {
  it('round-trip закупки возвращает исходный остаток', () => {
    const doc = { type: 'purchase', no: 'ЗАК-9', items: [{ productId: 'p1', name: 'Гвозди', qty: 40 }] }
    const posted = applyDocToState(makeState(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(stockOf(rolled, 'p1')).toBe(100)
  })

  it('round-trip продажи возвращает исходный остаток', () => {
    const doc = { type: 'sale', no: 'ПРД-9', items: [{ productId: 'p1', name: 'Гвозди', qty: 30 }] }
    const posted = applyDocToState(makeState(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(stockOf(rolled, 'p1')).toBe(100)
  })

  it('откат инвентаризации возвращает prevStock', () => {
    const doc = {
      type: 'inventory', no: 'ИНВ-9',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 90, prevStock: 100 }],
    }
    const posted = applyDocToState(makeState(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(stockOf(rolled, 'p1')).toBe(100)
  })

  it('откат перемещения возвращает исходный склад (fromWh)', () => {
    const doc = {
      type: 'transfer', no: 'ПРМ-9', toWarehouseId: 'wh2',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 100, fromWh: 'wh1' }],
    }
    const posted = applyDocToState(makeState(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(whOf(rolled, 'p1')).toBe('wh1')
  })

  it('движение отката помечается причиной «Отмена · <номер>»', () => {
    const doc = { type: 'sale', no: 'ПРД-9', items: [{ productId: 'p1', name: 'Гвозди', qty: 30 }] }
    const posted = applyDocToState(makeState(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(rolled.movements[0].reason).toBe('Отмена · ПРД-9')
  })
})

describe('applyDocToState — себестоимость при закупке', () => {
  const stateWithCost = () => ({
    products: [{ id: 'p1', name: 'Гвозди', unit: 'кг', stock: 100, cost: 10, warehouseId: 'wh1' }],
    movements: [],
  })
  const costOf = (s, id) => s.products.find((p) => p.id === id).cost

  it('обновляет себестоимость по средневзвешенной', () => {
    const doc = { type: 'purchase', no: 'ЗАК-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 100, cost: 20 }] }
    const next = applyDocToState(stateWithCost(), doc, 1, 'u1')
    expect(costOf(next, 'p1')).toBe(15) // (100*10 + 100*20)/200
    expect(stockOf(next, 'p1')).toBe(200)
  })

  it('без цены прихода себестоимость не меняется', () => {
    const doc = { type: 'purchase', no: 'ЗАК-2', items: [{ productId: 'p1', name: 'Гвозди', qty: 100 }] }
    const next = applyDocToState(stateWithCost(), doc, 1, 'u1')
    expect(costOf(next, 'p1')).toBe(10)
  })

  it('откат закупки возвращает прежнюю себестоимость', () => {
    const doc = { type: 'purchase', no: 'ЗАК-3', items: [{ productId: 'p1', name: 'Гвозди', qty: 100, cost: 20 }] }
    const posted = applyDocToState(stateWithCost(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    expect(costOf(rolled, 'p1')).toBe(10)
    expect(stockOf(rolled, 'p1')).toBe(100)
  })
})

// ── Партионный учёт (FIFO) ────────────────────────────────────────────
// Товары с полем batches работают по новой модели: приход добавляет партию,
// расход списывает по FIFO, cost — производная weightedCostFromBatches().

describe('applyDocToState — FIFO при списании', () => {
  const withBatches = () => ({
    products: [
      {
        id: 'p1',
        name: 'Гвозди',
        unit: 'кг',
        warehouseId: 'wh1',
        stock: 20, // 10 старой партии по 100 + 10 новой по 200
        cost: 150,
        batches: [
          { id: 'b1', qty: 10, cost: 100, at: '2026-01-01T00:00:00Z' },
          { id: 'b2', qty: 10, cost: 200, at: '2026-06-01T00:00:00Z' },
        ],
      },
    ],
    movements: [],
  })

  it('продажа списывает старейшую партию первой; movement.cost = COGS', () => {
    const doc = { type: 'sale', no: 'ПРД-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 15 }] }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(5) // 20 - 15
    // 10 из партии-100 + 5 из партии-200 = 1000 + 1000 = 2000
    expect(next.movements[0].cost).toBe(2000)
    // Осталась одна партия по 200
    expect(p.batches).toHaveLength(1)
    expect(p.batches[0].qty).toBe(5)
    expect(p.batches[0].cost).toBe(200)
    // cost товара — теперь weighted по остатку
    expect(p.cost).toBe(200)
  })

  it('закупка добавляет партию по своей цене, не смешивая со старыми', () => {
    const doc = { type: 'purchase', no: 'ЗАК-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 10, cost: 300 }] }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(30)
    expect(p.batches).toHaveLength(3)
    // Средняя по остатку: (10*100 + 10*200 + 10*300) / 30 = 200
    expect(p.cost).toBe(200)
  })

  it('откат продажи возвращает партии в исходное состояние', () => {
    const doc = { type: 'sale', no: 'ПРД-2', items: [{ productId: 'p1', name: 'Гвозди', qty: 15 }] }
    const posted = applyDocToState(withBatches(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    const p = rolled.products[0]
    expect(p.stock).toBe(20)
    // Обе партии восстановлены — 10 по 100 и 10 по 200
    const byCost = Object.fromEntries(p.batches.map((b) => [b.cost, b.qty]))
    expect(byCost[100]).toBe(10)
    expect(byCost[200]).toBe(10)
  })

  it('откат закупки удаляет только добавленную партию', () => {
    const doc = { type: 'purchase', no: 'ЗАК-2', items: [{ productId: 'p1', name: 'Гвозди', qty: 10, cost: 300 }] }
    const posted = applyDocToState(withBatches(), doc, 1, 'u1')
    const rolled = applyDocToState(posted, doc, -1, 'u1')
    const p = rolled.products[0]
    expect(p.stock).toBe(20)
    expect(p.batches).toHaveLength(2)
    expect(p.batches.some((b) => b.cost === 300)).toBe(false)
  })

  it('возврат от клиента добавляет партию (по текущей средней), не трогая существующие', () => {
    const doc = { type: 'sale_return', no: 'ВЗП-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 5 }] }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(25)
    expect(p.batches).toHaveLength(3) // 2 + 1 новая
    // Новая партия — по текущей средней 150 (10*100 + 10*200)/20 = 150
    expect(p.batches.some((b) => b.qty === 5 && b.cost === 150)).toBe(true)
  })

  it('возврат поставщику списывает по FIFO (как sale)', () => {
    const doc = { type: 'supplier_return', no: 'ВЗС-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 12 }] }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(8) // 20 - 12
    // 10 из старой (100) + 2 из новой (200) = 1400
    expect(next.movements[0].cost).toBe(1400)
    expect(p.batches).toHaveLength(1)
    expect(p.batches[0].qty).toBe(8)
    expect(p.batches[0].cost).toBe(200)
  })

  it('инвентаризация излишек: добавляется партия по текущей средней', () => {
    const doc = {
      type: 'inventory',
      no: 'ИНВ-1',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 25, prevStock: 20 }], // излишек +5
    }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(25)
    // Есть добавленная партия +5 по средней 150
    expect(p.batches.some((b) => b.qty === 5 && b.cost === 150)).toBe(true)
  })

  it('инвентаризация недостача: списывается по FIFO', () => {
    const doc = {
      type: 'inventory',
      no: 'ИНВ-2',
      items: [{ productId: 'p1', name: 'Гвозди', qty: 5, prevStock: 20 }], // недостача −15
    }
    const next = applyDocToState(withBatches(), doc, 1, 'u1')
    const p = next.products[0]
    expect(p.stock).toBe(5)
    // Партия-100 съедена полностью, партия-200 стала 5
    expect(p.batches).toHaveLength(1)
    expect(p.batches[0].cost).toBe(200)
  })
})

describe('applyDocToState — чистота функции', () => {
  it('не мутирует исходное состояние', () => {
    const state = makeState()
    const doc = { type: 'purchase', no: 'ЗАК-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 40 }] }
    applyDocToState(state, doc, 1, 'u1')
    expect(stockOf(state, 'p1')).toBe(100) // оригинал нетронут
    expect(state.movements).toHaveLength(0)
  })

  it('новые движения добавляются в начало журнала', () => {
    const state = makeState({ movements: [{ id: 'old', type: 'in' }] })
    const doc = { type: 'purchase', no: 'ЗАК-1', items: [{ productId: 'p1', name: 'Гвозди', qty: 5 }] }
    const next = applyDocToState(state, doc, 1, 'u1')
    expect(next.movements[0].qty).toBe(5)
    expect(next.movements[next.movements.length - 1].id).toBe('old')
  })
})
