// Тесты для useStore — бизнес-логика склада (login, заказы, документы,
// платежи, инвентаризация, настройки). Работают с реальным zustand-стором;
// перед каждым тестом сбрасываем состояние через сохранённый начальный snapshot.
//
// Тесты — сетка безопасности перед возможным рефакторингом стора на слайсы.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// supabase.js создаёт клиент, если .env содержит VITE_SUPABASE_URL/KEY,
// и в конструкторе трогает window.localStorage. В тестах (env=node) это
// падает с ReferenceError. Мокаем — тесты живут в чисто offline-режиме.
vi.mock('../lib/supabase', () => ({
  hasSupabase: false,
  supabase: null,
  recoveryTokens: null,
}))

import { useStore } from './useStore'
import { makeSeed } from './seed'
import { hashPin } from '../lib/crypto'

const seedSnapshot = makeSeed()

// Сброс стора к чистому seed + отключаем облако.
// Важно: без `replace: true` — иначе setState стёр бы actions (в zustand v5
// они лежат в самом сторе рядом с state), и следующий тест не смог бы
// вызвать updateSettings / transferStock и т.п.
function resetStore() {
  const fresh = makeSeed()
  useStore.setState({
    ...fresh,
    authUserId: null,
    cloud: false,
    cloudReady: false,
    cloudError: null,
    companyId: null,
    companyName: null,
    needOnboarding: false,
    _authInited: false,
    _bootBusy: false,
    _creating: false,
  })
}

beforeEach(resetStore)

// Быстрые селекторы
const state = () => useStore.getState()
const productById = (id) => state().products.find((p) => p.id === id)

describe('login / PIN', () => {
  it('успешный вход по legacy raw PIN (seed) переключает authUserId', async () => {
    // seed содержит e1..e4 с raw PIN 1111..4444
    const r = await state().login('e1', '1111')
    expect(r.ok).toBe(true)
    expect(state().authUserId).toBe('e1')
  })

  it('после legacy-входа сохранённый PIN становится хэшем (ленивая миграция)', async () => {
    await state().login('e1', '1111')
    const stored = state().employees.find((e) => e.id === 'e1').pin
    expect(stored).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
    expect(stored).not.toBe('1111')
  })

  it('после миграции повторный вход тем же PIN всё ещё работает (verify по хэшу)', async () => {
    await state().login('e1', '1111')
    state().logout()
    const r = await state().login('e1', '1111')
    expect(r.ok).toBe(true)
  })

  it('неверный PIN → ok=false, authUserId остаётся null', async () => {
    const r = await state().login('e1', '9999')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/PIN/i)
    expect(state().authUserId).toBeNull()
  })

  it('несуществующий сотрудник → ok=false', async () => {
    const r = await state().login('e-нет', '1111')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/не найден/i)
  })

  it('отключённый сотрудник → ok=false, авторизация не проходит', async () => {
    useStore.setState((s) => ({
      employees: s.employees.map((e) =>
        e.id === 'e1' ? { ...e, active: false } : e,
      ),
    }))
    const r = await state().login('e1', '1111')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/отключен/i)
  })

  it('logout сбрасывает authUserId', async () => {
    await state().login('e1', '1111')
    state().logout()
    expect(state().authUserId).toBeNull()
  })
})

describe('addEmployee / updateEmployee — PIN хэшируется', () => {
  it('addEmployee: заданный PIN уезжает в стор уже как хэш', async () => {
    await state().addEmployee({ name: 'Новый', role: 'stock', pin: '5678' })
    const created = state().employees.at(-1)
    expect(created.name).toBe('Новый')
    expect(created.pin).toMatch(/^[0-9a-f]{64}$/)
    expect(created.pin).toBe(await hashPin('5678'))
  })

  it('updateEmployee patch с pin — хэшируется', async () => {
    await state().updateEmployee('e2', { pin: '9999' })
    const e = state().employees.find((x) => x.id === 'e2')
    expect(e.pin).toBe(await hashPin('9999'))
  })

  it('updateEmployee без pin — не трогает существующий PIN', async () => {
    const before = state().employees.find((e) => e.id === 'e2').pin
    await state().updateEmployee('e2', { role: 'admin' })
    const after = state().employees.find((e) => e.id === 'e2')
    expect(after.pin).toBe(before)
    expect(after.role).toBe('admin')
  })
})

describe('addOrder — резервирование остатка', () => {
  it('новый заказ: status=new, stockConsumed=false (физически не списан)', () => {
    const before = state().products[0].stock
    state().addOrder({
      customerId: state().customers[0].id,
      customerName: state().customers[0].name,
      items: [
        { productId: state().products[0].id, name: '...', qty: 5, price: 100 },
      ],
      total: 500,
    })
    const order = state().orders[0]
    expect(order.status).toBe('new')
    expect(order.stockConsumed).toBe(false)
    // резерв — не физическое списание, поэтому p.stock не изменился
    expect(state().products[0].stock).toBe(before)
  })

  it('«в долг»: balance клиента увеличивается сразу при создании заказа', () => {
    const cust = state().customers[0]
    const before = cust.balance || 0
    state().addOrder({
      customerId: cust.id,
      customerName: cust.name,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 1000 }],
      total: 1000,
      onCredit: true,
    })
    const after = state().customers.find((c) => c.id === cust.id).balance
    expect(after).toBe(before + 1000)
  })
})

describe('setOrderStatus — физическое списание при отгрузке', () => {
  it('переход в shipped списывает остаток и помечает stockConsumed=true', () => {
    const p = state().products.find((x) => x.stock >= 10)
    state().addOrder({
      customerId: state().customers[0].id,
      customerName: state().customers[0].name,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 3, price: 100 }],
      total: 300,
    })
    const orderId = state().orders[0].id
    const stockBefore = productById(p.id).stock

    state().setOrderStatus(orderId, 'shipped')
    const o = state().orders.find((x) => x.id === orderId)
    expect(o.status).toBe('shipped')
    expect(o.stockConsumed).toBe(true)
    expect(productById(p.id).stock).toBe(stockBefore - 3)
  })

  it('повторный переход между shipped/delivered не списывает второй раз', () => {
    const p = state().products.find((x) => x.stock >= 10)
    state().addOrder({
      customerId: state().customers[0].id,
      customerName: state().customers[0].name,
      items: [{ productId: p.id, name: p.name, qty: 2, price: 100 }],
      total: 200,
    })
    const id = state().orders[0].id
    const before = productById(p.id).stock
    state().setOrderStatus(id, 'shipped')
    state().setOrderStatus(id, 'delivered')
    expect(productById(p.id).stock).toBe(before - 2)
  })
})

describe('cancelOrder — возврат резерва и остатков', () => {
  it('до отгрузки: снимает резерв без изменения физического остатка', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 5, price: 100 }],
      total: 500,
    })
    const orderId = state().orders[0].id
    const stockBefore = productById(p.id).stock

    state().cancelOrder(orderId, 'клиент отказался')

    const o = state().orders.find((x) => x.id === orderId)
    expect(o.status).toBe('cancelled')
    expect(productById(p.id).stock).toBe(stockBefore) // не изменилось
  })

  it('после отгрузки: возвращает остаток на склад', () => {
    const p = state().products.find((x) => x.stock >= 10)
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 3, price: 100 }],
      total: 300,
    })
    const id = state().orders[0].id
    const stockOrig = productById(p.id).stock
    state().setOrderStatus(id, 'shipped')
    expect(productById(p.id).stock).toBe(stockOrig - 3)

    state().cancelOrder(id, 'клиент вернул')
    expect(productById(p.id).stock).toBe(stockOrig)
  })

  it('«в долг»: отмена уменьшает balance клиента', () => {
    const cust = state().customers[0]
    const before = cust.balance || 0
    state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 1000 }],
      total: 1000,
      onCredit: true,
    })
    const id = state().orders[0].id
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(before + 1000)

    state().cancelOrder(id)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(before)
  })

  it('идемпотентно: повторный cancel не двигает остаток дважды', () => {
    const p = state().products.find((x) => x.stock >= 10)
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 3, price: 100 }],
      total: 300,
    })
    const id = state().orders[0].id
    state().setOrderStatus(id, 'shipped')
    const after = productById(p.id).stock
    state().cancelOrder(id)
    state().cancelOrder(id) // повторно
    expect(productById(p.id).stock).toBe(after + 3)
  })
})

describe('addPayment — оплата гасит долг', () => {
  it('баланс уменьшается на сумму оплаты (не уходит в отрицательное)', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 1000 } : c)),
    }))
    state().addPayment(cust.id, 300)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(700)
    state().addPayment(cust.id, 9999)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(0)
  })

  it('нулевая / отрицательная сумма — игнорируется', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 500 } : c)),
    }))
    state().addPayment(cust.id, 0)
    state().addPayment(cust.id, -100)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(500)
  })
})

describe('addDocument — предпроверка остатка', () => {
  it('sale больше остатка → { ok:false, error }; документ не создаётся', () => {
    const p = state().products[0]
    const docsBefore = state().documents.length
    const r = state().addDocument({
      type: 'sale',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: p.stock + 1000 }],
    })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/не хватает остатка/i) })
    expect(state().documents.length).toBe(docsBefore)
    expect(productById(p.id).stock).toBe(p.stock) // не тронуто
  })

  it('writeoff больше остатка → { ok:false }', () => {
    const p = state().products[0]
    const r = state().addDocument({
      type: 'writeoff',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: p.stock + 1 }],
      reason: 'Порча',
    })
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/не хватает остатка/i) })
  })

  it('supplier_return больше остатка → { ok:false }', () => {
    const p = state().products[0]
    const r = state().addDocument({
      type: 'supplier_return',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: p.stock + 1 }],
    })
    expect(r && r.ok).toBe(false)
  })

  it('purchase не имеет ограничения по остатку (приход)', () => {
    const p = state().products[0]
    const before = p.stock
    const id = state().addDocument({
      type: 'purchase',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 100, cost: 50 }],
    })
    expect(typeof id).toBe('string') // успех — вернулся id
    expect(productById(p.id).stock).toBe(before + 100)
  })

  it('draft (opts.post=false) списание можно сохранить даже с превышением', () => {
    const p = state().products[0]
    const id = state().addDocument(
      {
        type: 'sale',
        items: [{ productId: p.id, name: p.name, unit: p.unit, qty: p.stock + 1000 }],
      },
      { post: false },
    )
    expect(typeof id).toBe('string')
    expect(state().documents[0].status).toBe('draft')
    // остаток не тронут — черновик не проводит
    expect(productById(p.id).stock).toBe(p.stock)
  })

  it('purchase обновляет средневзвешенную себестоимость', () => {
    const p = state().products[0]
    // приводим к известному состоянию
    useStore.setState((s) => ({
      products: s.products.map((x) => (x.id === p.id ? { ...x, stock: 10, cost: 100 } : x)),
    }))
    state().addDocument({
      type: 'purchase',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 10, cost: 200 }],
    })
    // средневзвешенная: (10*100 + 10*200) / (10+10) = 150
    expect(productById(p.id).cost).toBeCloseTo(150, 2)
    expect(productById(p.id).stock).toBe(20)
  })
})

describe('applyInventory — инвентаризация фиксирует излишек/недостачу', () => {
  it('фактический остаток замещает учётный + запись в movements', () => {
    const p = state().products[0]
    useStore.setState((s) => ({
      products: s.products.map((x) => (x.id === p.id ? { ...x, stock: 20 } : x)),
    }))
    const before = state().movements.length
    state().applyInventory({ [p.id]: 25 })
    expect(productById(p.id).stock).toBe(25)
    const mv = state().movements[0]
    expect(mv.type).toBe('inventory')
    expect(mv.delta).toBe(5)
    expect(mv.reason).toBe('Излишек')
    expect(state().movements.length).toBe(before + 1)
  })

  it('недостача: delta отрицательная, reason=«Недостача»', () => {
    const p = state().products[0]
    useStore.setState((s) => ({
      products: s.products.map((x) => (x.id === p.id ? { ...x, stock: 30 } : x)),
    }))
    state().applyInventory({ [p.id]: 20 })
    const mv = state().movements[0]
    expect(mv.delta).toBe(-10)
    expect(mv.reason).toBe('Недостача')
  })

  it('без изменений — движение не пишется', () => {
    const p = state().products[0]
    const before = state().movements.length
    state().applyInventory({ [p.id]: p.stock })
    expect(state().movements.length).toBe(before)
  })
})

describe('updateSettings — мержит патч', () => {
  it('патч сливается со старыми настройками, остальные ключи сохраняются', () => {
    const initial = state().settings
    state().updateSettings({ currency: '₸' })
    expect(state().settings.currency).toBe('₸')
    expect(state().settings.company).toBe(initial.company) // не потерялось
  })
})

describe('transferStock — перемещение между складами', () => {
  it('warehouseId и cell меняются, физический остаток НЕ трогается', () => {
    const p = state().products.find((x) => x.warehouseId === 'wh1')
    const stockBefore = p.stock
    state().transferStock(p.id, 'wh2', 'A1', 5)
    const after = productById(p.id)
    expect(after.warehouseId).toBe('wh2')
    expect(after.cell).toBe('A1')
    expect(after.stock).toBe(stockBefore) // перемещение — не расход
    const mv = state().movements[0]
    expect(mv.type).toBe('transfer')
    expect(mv.delta).toBe(0)
  })
})

// Sanity check: seed стабилен от теста к тесту
describe('seed / resetStore — база чиста', () => {
  it('после resetStore products и orders совпадают с seed', () => {
    expect(state().products.length).toBe(seedSnapshot.products.length)
    expect(state().employees[0].id).toBe('e1')
  })
})
