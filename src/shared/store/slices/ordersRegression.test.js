import { describe, it, expect, vi } from 'vitest'
import { createOrdersSlice } from './ordersSlice'

vi.mock('../../lib/cloud', () => ({ enqueueSale: vi.fn(), enqueueOrderStatus: vi.fn() }))

function store() {
  const s = {
    orders: [],
    products: [{ id: 'p', stock: 10, cost: 50 }],
    customers: [{ id: 'c', balance: 0, creditLimit: 1000 }],
    accounts: [{ id: 'cash', kind: 'cash' }],
    moneyTx: [],
    shifts: [],
    logAction: vi.fn(),
    recalcClosedShift: vi.fn(),
    addMoneyTx: (tx) => s.moneyTx.push(tx),
  }
  Object.assign(
    s,
    createOrdersSlice(
      (patch) => Object.assign(s, typeof patch === 'function' ? patch(s) : patch),
      () => s,
    ),
  )
  return s
}

function sale(s, total = 900) {
  return s.createSaleDocument({
    customerId: 'c',
    total,
    discount: 10,
    items: [{ productId: 'p', qty: 10, price: 100 }],
    payment: { method: 'cash', cashPaid: total },
  }).id
}

describe('регрессии учёта', () => {
  it('полный возврат учитывает скидку и восстанавливает склад', () => {
    const s = store()
    const id = sale(s)
    expect(s.products[0].stock).toBe(0)
    expect(s.refundOrder(id).total).toBe(900)
    expect(s.products[0].stock).toBe(10)
    expect(s.moneyTx.filter((t) => t.type === 'out').reduce((n, t) => n + t.amount, 0)).toBe(900)
  })
  it('после частичного возврата нельзя вернуть больше оставшегося', () => {
    const s = store()
    const id = sale(s)
    expect(s.refundOrder(id, { items: [{ productId: 'p', qty: 6 }] }).ok).toBe(true)
    expect(s.products[0].stock).toBe(6)
    expect(s.refundOrder(id, { items: [{ productId: 'p', qty: 5 }] }).ok).toBe(false)
    expect(s.products[0].stock).toBe(6)
    expect(s.refundOrder(id).total).toBe(360)
    expect(s.products[0].stock).toBe(10)
    expect(s.refundOrder(id).ok).toBe(false)
    expect(s.moneyTx.filter((t) => t.type === 'out').reduce((n, t) => n + t.amount, 0)).toBe(900)
  })
  it('отклоняет повторяющиеся позиции, превышающие купленное количество', () => {
    const s = store()
    const id = sale(s)
    expect(
      s.refundOrder(id, {
        items: [
          { productId: 'p', qty: 6 },
          { productId: 'p', qty: 6 },
        ],
      }).ok,
    ).toBe(false)
    expect(s.products[0].stock).toBe(0)
  })
  it('отклоняет отрицательный возврат без изменения склада', () => {
    const s = store()
    const id = sale(s)
    expect(s.refundOrder(id, { items: [{ productId: 'p', qty: -1 }] }).ok).toBe(false)
    expect(s.products[0].stock).toBe(0)
  })
  it('при редактировании проверяет кредитный лимит после пересчёта суммы', () => {
    const s = store()
    const { id } = s.addOrder({
      customerId: 'c',
      onCredit: true,
      total: 500,
      items: [{ productId: 'p', qty: 5, price: 100 }],
    })
    expect(s.customers[0].balance).toBe(500)
    expect(s.updateOrder(id, { items: [{ productId: 'p', qty: 15, price: 100 }] }).ok).toBe(false)
    expect(s.customers[0].balance).toBe(500)
    expect(s.orders[0].total).toBe(500)
  })
  it('переносит долг при смене клиента заказа', () => {
    const s = store()
    s.customers.push({ id: 'other', balance: -100, creditLimit: 1000 })
    const { id } = s.addOrder({ customerId: 'c', onCredit: true, total: 500, items: [] })
    expect(s.updateOrder(id, { customerId: 'other' }).ok).toBe(true)
    expect(s.customers[0].balance).toBe(0)
    expect(s.customers[1].balance).toBe(400)
  })
  it('два частичных возврата смешанной оплаты не превышают наличную часть', () => {
    const s = store()
    s.accounts.push({ id: 'bank', kind: 'bank' })
    const { id } = s.createSaleDocument({
      total: 1000,
      items: [{ productId: 'p', qty: 10, price: 100 }],
      payment: { method: 'mixed', cashPaid: 600, cardPaid: 400 },
    })
    s.refundOrder(id, { items: [{ productId: 'p', qty: 5 }] })
    s.refundOrder(id, { items: [{ productId: 'p', qty: 5 }] })
    const outgoing = s.moneyTx.filter((t) => t.type === 'out')
    expect(outgoing.filter((t) => t.accountId === 'cash').reduce((n, t) => n + t.amount, 0)).toBe(
      600,
    )
    expect(outgoing.filter((t) => t.accountId === 'bank').reduce((n, t) => n + t.amount, 0)).toBe(
      400,
    )
  })
})
