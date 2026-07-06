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
