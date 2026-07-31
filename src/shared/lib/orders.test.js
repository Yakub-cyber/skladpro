import { describe, it, expect } from 'vitest'
import {
  applyOrderStock,
  reservedByProduct,
  availableStock,
  OPEN_STATUSES,
  stockConsumedFromStatus,
  migrateReservationV8,
} from './orders'

const baseState = () => ({
  products: [
    { id: 'p1', name: 'Гвозди', stock: 100, marked: false },
    { id: 'p2', name: 'Молоток', stock: 10, marked: false },
    { id: 'p3', name: 'Сигареты', stock: 5, marked: true, codes: ['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'] },
  ],
})
const stock = (res, id) => res.products.find((p) => p.id === id).stock
const codes = (res, id) => res.products.find((p) => p.id === id).codes

describe('reservedByProduct — резерв по открытым заказам', () => {
  const orders = [
    { status: 'new', items: [{ productId: 'p1', qty: 10 }] },
    { status: 'picking', items: [{ productId: 'p1', qty: 5 }, { productId: 'p2', qty: 2 }] },
    { status: 'shipped', items: [{ productId: 'p1', qty: 100 }] }, // отгружен → НЕ резерв
    { status: 'cancelled', items: [{ productId: 'p1', qty: 50 }] }, // отменён → НЕ резерв
  ]

  it('суммирует кол-во только по открытым статусам', () => {
    const r = reservedByProduct(orders)
    expect(r.p1).toBe(15) // 10 + 5 (shipped и cancelled не входят)
    expect(r.p2).toBe(2)
  })

  it('пустой список → пустой резерв', () => {
    expect(reservedByProduct([])).toEqual({})
  })

  it('OPEN_STATUSES не включает shipped/delivered/cancelled', () => {
    expect(OPEN_STATUSES).not.toContain('shipped')
    expect(OPEN_STATUSES).not.toContain('delivered')
    expect(OPEN_STATUSES).not.toContain('cancelled')
  })
})

describe('availableStock — доступно к продаже', () => {
  it('остаток минус резерв', () => {
    expect(availableStock({ id: 'p1', stock: 100 }, { p1: 15 })).toBe(85)
  })
  it('без резерва равно остатку', () => {
    expect(availableStock({ id: 'p1', stock: 100 }, {})).toBe(100)
  })
  it('может быть отрицательным при перепродаже', () => {
    expect(availableStock({ id: 'p1', stock: 3 }, { p1: 10 })).toBe(-7)
  })
})

describe('applyOrderStock — отгрузка (dir=-1)', () => {
  it('списывает физический остаток', () => {
    const res = applyOrderStock(baseState(), { items: [{ productId: 'p1', qty: 30 }] }, -1)
    expect(stock(res, 'p1')).toBe(70)
  })
  it('не трогает товары вне заказа', () => {
    const res = applyOrderStock(baseState(), { items: [{ productId: 'p1', qty: 10 }] }, -1)
    expect(stock(res, 'p2')).toBe(10)
  })
  it('не уводит в минус', () => {
    const res = applyOrderStock(baseState(), { items: [{ productId: 'p2', qty: 999 }] }, -1)
    expect(stock(res, 'p2')).toBe(0)
  })
  it('коды маркировки выбывают и запоминаются в позиции', () => {
    const res = applyOrderStock(baseState(), { items: [{ productId: 'p3', qty: 2 }] }, -1)
    expect(codes(res, 'p3')).toEqual(['КМ3', 'КМ4', 'КМ5'])
    expect(res.order.items[0].codes).toEqual(['КМ1', 'КМ2'])
  })
})

describe('applyOrderStock — возврат при отмене (dir=+1)', () => {
  it('возвращает остаток', () => {
    const res = applyOrderStock(baseState(), { items: [{ productId: 'p1', qty: 30 }] }, 1)
    expect(stock(res, 'p1')).toBe(130)
  })
  it('восстанавливает выбывшие коды без дублей', () => {
    const state = baseState()
    state.products[2].codes = ['КМ3', 'КМ4', 'КМ5']
    const res = applyOrderStock(state, { items: [{ productId: 'p3', qty: 2, codes: ['КМ1', 'КМ2'] }] }, 1)
    expect(codes(res, 'p3').sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
  })
})

describe('applyOrderStock — round-trip (отгрузка → возврат)', () => {
  it('остаток и коды возвращаются к исходным', () => {
    const order = { items: [{ productId: 'p1', qty: 25 }, { productId: 'p3', qty: 3 }] }
    const shipped = applyOrderStock(baseState(), order, -1)
    const returned = applyOrderStock(shipped, shipped.order, 1)
    expect(stock(returned, 'p1')).toBe(100)
    expect(stock(returned, 'p3')).toBe(5)
    expect(codes(returned, 'p3').sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
  })
})

describe('stockConsumedFromStatus — флаг списания из статуса', () => {
  it('shipped/delivered → списан', () => {
    expect(stockConsumedFromStatus('shipped')).toBe(true)
    expect(stockConsumedFromStatus('delivered')).toBe(true)
  })
  it('открытые и отменённый → не списан', () => {
    for (const s of [...OPEN_STATUSES, 'cancelled', undefined]) {
      expect(stockConsumedFromStatus(s)).toBe(false)
    }
  })
})

describe('migrateReservationV8 — миграция на модель резервирования', () => {
  // Старая модель списала остаток при создании: у товара уже уменьшенный stock,
  // а у открытого заказа в позиции записаны выбывшие коды маркировки.
  const oldState = () => ({
    products: [
      { id: 'p1', stock: 70, marked: false }, // было 100, открытый заказ на 30 списал
      { id: 'p3', stock: 3, marked: true, codes: ['КМ3', 'КМ4', 'КМ5'] }, // 2 кода выбыли
    ],
    orders: [
      { id: 'o1', status: 'new', items: [{ productId: 'p1', qty: 30 }] },
      { id: 'o2', status: 'picking', items: [{ productId: 'p3', qty: 2, codes: ['КМ1', 'КМ2'] }] },
      { id: 'o3', status: 'delivered', items: [{ productId: 'p1', qty: 5 }] },
      { id: 'o4', status: 'cancelled', items: [{ productId: 'p1', qty: 9 }] },
    ],
  })
  const ord = (r, id) => r.orders.find((o) => o.id === id)
  const prod = (r, id) => r.products.find((p) => p.id === id)

  it('открытым заказам возвращает остаток на склад', () => {
    const r = migrateReservationV8(oldState())
    expect(prod(r, 'p1').stock).toBe(100) // 70 + 30 (открытый o1); o3/o4 не трогают
  })

  it('открытым заказам возвращает коды маркировки в пул и снимает с позиции', () => {
    const r = migrateReservationV8(oldState())
    expect(prod(r, 'p3').codes.sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
    expect(ord(r, 'o2').items[0].codes).toEqual([]) // коды вернулись в пул
    expect(prod(r, 'p3').stock).toBe(5) // 3 + 2
  })

  it('проставляет stockConsumed по статусу', () => {
    const r = migrateReservationV8(oldState())
    expect(ord(r, 'o1').stockConsumed).toBe(false) // открытый
    expect(ord(r, 'o2').stockConsumed).toBe(false) // открытый
    expect(ord(r, 'o3').stockConsumed).toBe(true) // доставлен
    expect(ord(r, 'o4').stockConsumed).toBe(false) // отменён
  })

  it('идемпотентна: повторный прогон не возвращает остаток дважды', () => {
    const once = migrateReservationV8(oldState())
    const twice = migrateReservationV8(once)
    expect(prod(twice, 'p1').stock).toBe(100)
    expect(prod(twice, 'p3').codes.sort()).toEqual(['КМ1', 'КМ2', 'КМ3', 'КМ4', 'КМ5'])
  })

  it('заказы с уже проставленным stockConsumed пропускаются', () => {
    const state = {
      products: [{ id: 'p1', stock: 50 }],
      orders: [{ id: 'o1', status: 'new', stockConsumed: false, items: [{ productId: 'p1', qty: 10 }] }],
    }
    const r = migrateReservationV8(state)
    expect(prod(r, 'p1').stock).toBe(50) // не трогаем — уже новая модель
  })
})
