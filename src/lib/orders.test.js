import { describe, it, expect } from 'vitest'
import { applyOrderStock } from './orders'

// Базовое состояние для тестов
const baseState = () => ({
  products: [
    { id: 'p1', name: 'Гвозди', stock: 100, marked: false },
    { id: 'p2', name: 'Молоток', stock: 10, marked: false },
    { id: 'p3', name: 'Сигареты', stock: 5, marked: true, codes: ['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'] },
  ],
  customers: [{ id: 'c1', name: 'ООО Ромашка', balance: 0 }],
})

const stock = (res, id) => res.products.find((p) => p.id === id).stock
const codes = (res, id) => res.products.find((p) => p.id === id).codes
const balance = (res, id) => res.customers.find((c) => c.id === id).balance

describe('applyOrderStock — резерв при создании (dir=-1)', () => {
  it('списывает остатки по позициям заказа', () => {
    const order = { items: [{ productId: 'p1', qty: 30 }, { productId: 'p2', qty: 4 }] }
    const res = applyOrderStock(baseState(), order, -1)
    expect(stock(res, 'p1')).toBe(70)
    expect(stock(res, 'p2')).toBe(6)
  })

  it('не трогает товары вне заказа', () => {
    const order = { items: [{ productId: 'p1', qty: 10 }] }
    const res = applyOrderStock(baseState(), order, -1)
    expect(stock(res, 'p2')).toBe(10)
    expect(stock(res, 'p3')).toBe(5)
  })

  it('не уводит остаток в минус (пол = 0)', () => {
    const order = { items: [{ productId: 'p2', qty: 999 }] }
    const res = applyOrderStock(baseState(), order, -1)
    expect(stock(res, 'p2')).toBe(0)
  })

  it('выбывшие коды маркировки списываются и запоминаются в позиции', () => {
    const order = { items: [{ productId: 'p3', qty: 2 }] }
    const res = applyOrderStock(baseState(), order, -1)
    expect(codes(res, 'p3')).toEqual(['КМ3', 'КМ4', 'КМ5'])
    expect(res.order.items[0].codes).toEqual(['КМ1', 'КМ2'])
  })

  it('увеличивает долг для заказа «в долг»', () => {
    const order = { items: [], onCredit: true, customerId: 'c1', total: 5000 }
    const res = applyOrderStock(baseState(), order, -1)
    expect(balance(res, 'c1')).toBe(5000)
  })

  it('не трогает долг для обычного заказа', () => {
    const order = { items: [{ productId: 'p1', qty: 10 }], total: 5000 }
    const res = applyOrderStock(baseState(), order, -1)
    expect(balance(res, 'c1')).toBe(0)
  })
})

describe('applyOrderStock — возврат при отмене (dir=+1)', () => {
  it('возвращает остатки на склад', () => {
    const order = { items: [{ productId: 'p1', qty: 30 }] }
    const res = applyOrderStock(baseState(), order, 1)
    expect(stock(res, 'p1')).toBe(130)
  })

  it('восстанавливает ранее выбывшие коды без дублей', () => {
    // позиция несёт коды, выбывшие при создании
    const order = { items: [{ productId: 'p3', qty: 2, codes: ['КМ1', 'КМ2'] }] }
    const state = baseState()
    state.products[2].codes = ['КМ3', 'КМ4', 'КМ5'] // осталось после списания
    const res = applyOrderStock(state, order, 1)
    expect(codes(res, 'p3').sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
  })

  it('списывает долг при отмене заказа «в долг»', () => {
    const order = { items: [], onCredit: true, customerId: 'c1', total: 5000 }
    const state = baseState()
    state.customers[0].balance = 5000
    const res = applyOrderStock(state, order, 1)
    expect(balance(res, 'c1')).toBe(0)
  })

  it('долг не уходит в минус при отмене', () => {
    const order = { items: [], onCredit: true, customerId: 'c1', total: 9999 }
    const res = applyOrderStock(baseState(), order, 1) // balance=0
    expect(balance(res, 'c1')).toBe(0)
  })
})

describe('applyOrderStock — round-trip (создание → отмена)', () => {
  it('остатки, коды и долг возвращаются к исходным', () => {
    const order = {
      items: [{ productId: 'p1', qty: 25 }, { productId: 'p3', qty: 3 }],
      onCredit: true,
      customerId: 'c1',
      total: 12000,
    }
    const start = baseState()
    const created = applyOrderStock(start, order, -1)
    // отменяем, используя order с записанными кодами
    const cancelled = applyOrderStock(created, created.order, 1)
    expect(stock(cancelled, 'p1')).toBe(100)
    expect(stock(cancelled, 'p3')).toBe(5)
    expect(codes(cancelled, 'p3').sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
    expect(balance(cancelled, 'c1')).toBe(0)
  })
})
