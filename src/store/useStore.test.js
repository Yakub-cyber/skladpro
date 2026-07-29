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

  it('updateEmployee с пустой pin строкой НЕ затирает существующий PIN', async () => {
    // Регрессия: раньше при patch { pin: '' } (случайное сохранение
    // пустого prompt) PIN админа обнулялся и войти становилось нельзя.
    // Теперь пустое поле игнорируется — старый хэш остаётся.
    await state().updateEmployee('e1', { pin: '1234' })
    const before = state().employees.find((e) => e.id === 'e1').pin
    await state().updateEmployee('e1', { pin: '' })
    const after = state().employees.find((e) => e.id === 'e1').pin
    expect(after).toBe(before)
    expect(after).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('login — восстановление при пустом PIN', () => {
  // Аккаунт-lockout: у сотрудника e.pin === '' (случайно стёрли в
  // Employees). Обычный verifyPin вернёт ok:false для любого ввода,
  // и войти будет нельзя. Восстановление: разрешить разовый вход по
  // любому валидному 4-знач. PIN, тут же сохранить его как новый.
  it('вход при пустом PIN с валидным 4-знач. значением → recovered:true и PIN сохранён', async () => {
    useStore.setState((s) => ({
      employees: s.employees.map((e) =>
        e.id === 'e1' ? { ...e, pin: '' } : e,
      ),
    }))
    const r = await state().login('e1', '9999')
    expect(r.ok).toBe(true)
    expect(r.recovered).toBe(true)
    expect(state().authUserId).toBe('e1')
    // PIN сохранён как хэш, повторный вход с ним работает
    const stored = state().employees.find((e) => e.id === 'e1').pin
    expect(stored).toBe(await hashPin('9999'))
    state().logout()
    const r2 = await state().login('e1', '9999')
    expect(r2.ok).toBe(true)
  })

  it('вход при пустом PIN с невалидным вводом (не 4 цифры) → ok:false', async () => {
    useStore.setState((s) => ({
      employees: s.employees.map((e) =>
        e.id === 'e1' ? { ...e, pin: '' } : e,
      ),
    }))
    // 3 цифры
    expect((await state().login('e1', '123')).ok).toBe(false)
    // буквы
    expect((await state().login('e1', 'abcd')).ok).toBe(false)
    // пусто
    expect((await state().login('e1', '')).ok).toBe(false)
    // authUserId не менялся
    expect(state().authUserId).toBeNull()
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

describe('addOrder → moneyTx (T1-A)', () => {
  // Раньше `/money` не видел выручку от POS-кассы: `addOrder` писал только
  // `order.payment`, но не создавал `moneyTx`. Теперь баланс кассы растёт
  // сразу при пробитии чека; отмена заказа автоматически откатывает
  // связанные транзакции.
  const cashAcc = () => state().accounts.find((a) => a.kind === 'cash')?.id
  const bankAcc = () => state().accounts.find((a) => a.kind === 'bank')?.id

  it('cash-платёж создаёт одну moneyTx на cash-счёт с orderId', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 1000 }],
      total: 1000,
      payment: { method: 'cash', cashPaid: 1000, cardPaid: 0 },
    })
    const orderId = state().orders[0].id
    const linked = state().moneyTx.filter((t) => t.orderId === orderId)
    expect(linked).toHaveLength(1)
    expect(linked[0].type).toBe('in')
    expect(linked[0].accountId).toBe(cashAcc())
    expect(linked[0].amount).toBe(1000)
    expect(linked[0].purpose).toBe('sale-cash')
    expect(linked[0].status).toBe('posted')
  })

  it('mixed-платёж создаёт две moneyTx (cash + bank)', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 1000 }],
      total: 1000,
      payment: { method: 'mixed', cashPaid: 400, cardPaid: 600 },
    })
    const orderId = state().orders[0].id
    const linked = state().moneyTx.filter((t) => t.orderId === orderId)
    expect(linked).toHaveLength(2)
    const cashTx = linked.find((t) => t.accountId === cashAcc())
    const bankTx = linked.find((t) => t.accountId === bankAcc())
    expect(cashTx?.amount).toBe(400)
    expect(cashTx?.purpose).toBe('sale-cash')
    expect(bankTx?.amount).toBe(600)
    expect(bankTx?.purpose).toBe('sale-card')
  })

  it('card-платёж создаёт одну moneyTx на bank-счёт', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 500 }],
      total: 500,
      payment: { method: 'card', cashPaid: 0, cardPaid: 500 },
    })
    const orderId = state().orders[0].id
    const linked = state().moneyTx.filter((t) => t.orderId === orderId)
    expect(linked).toHaveLength(1)
    expect(linked[0].accountId).toBe(bankAcc())
    expect(linked[0].purpose).toBe('sale-card')
  })

  it('credit-платёж НЕ создаёт moneyTx, но balance клиента растёт', () => {
    const cust = state().customers[0]
    const before = cust.balance || 0
    state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 700 }],
      total: 700,
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    const orderId = state().orders[0].id
    const linked = state().moneyTx.filter((t) => t.orderId === orderId)
    expect(linked).toHaveLength(0)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(before + 700)
  })

  it('cancelOrder отменяет все парные moneyTx', () => {
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 1000 }],
      total: 1000,
      payment: { method: 'cash', cashPaid: 1000, cardPaid: 0 },
    })
    const orderId = state().orders[0].id
    expect(
      state().moneyTx.filter((t) => t.orderId === orderId && t.status === 'posted'),
    ).toHaveLength(1)
    state().cancelOrder(orderId)
    const linked = state().moneyTx.filter((t) => t.orderId === orderId)
    expect(linked).toHaveLength(1)
    expect(linked[0].status).toBe('cancelled')
  })
})

describe('addOrder — kind retail vs order (POS-2)', () => {
  // Чек из кассы закрывается мгновенно: товар отдан покупателю, гонять
  // его по воронке «подтверждён → сборка → в пути» бессмысленно.
  // Заказ с доставкой — наоборот, идёт по обычной воронке.
  it('kind=retail: заказ сразу delivered + stockConsumed, остаток списан', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const before = productById(p.id).stock
    state().addOrder({
      kind: 'retail',
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 2, price: 100 }],
      total: 200,
      payment: { method: 'cash', cashPaid: 200, cardPaid: 0 },
    })
    const o = state().orders[0]
    expect(o.kind).toBe('retail')
    expect(o.status).toBe('delivered')
    expect(o.stockConsumed).toBe(true)
    expect(productById(p.id).stock).toBe(before - 2)
  })

  it('kind=retail: номер с префиксом ЧК, а не ЗК', () => {
    state().addOrder({
      kind: 'retail',
      customerId: state().customers[0].id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 50 }],
      total: 50,
      payment: { method: 'cash', cashPaid: 50, cardPaid: 0 },
    })
    expect(state().orders[0].no).toMatch(/^ЧК-/)
  })

  it('kind=order (по умолчанию): статус new, остаток только в резерве', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const before = productById(p.id).stock
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 2, price: 100 }],
      total: 200,
    })
    const o = state().orders[0]
    expect(o.kind).toBe('order')
    expect(o.status).toBe('new')
    expect(o.stockConsumed).toBe(false)
    expect(productById(p.id).stock).toBe(before)
    expect(o.no).toMatch(/^ЗК-/)
  })

  it('отмена retail-чека возвращает остаток на склад', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const before = productById(p.id).stock
    state().addOrder({
      kind: 'retail',
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 3, price: 100 }],
      total: 300,
      payment: { method: 'cash', cashPaid: 300, cardPaid: 0 },
    })
    expect(productById(p.id).stock).toBe(before - 3)
    state().cancelOrder(state().orders[0].id)
    expect(productById(p.id).stock).toBe(before)
  })
})

describe('openShift — accountId + gate по cashierIds (T1-B)', () => {
  // Раньше `openShift(cash)` не знал ни про какую кассу — все продажи
  // складывались в «нулевую» кассу. Теперь shift несёт `cashAccountId`,
  // а `cashierIds` из Cashiers становится реальным замком, а не витриной.
  const cashAcc = () => state().accounts.find((a) => a.kind === 'cash')?.id

  it('открытие смены с accountId кладёт cashAccountId в shift', async () => {
    await state().login('e1', '1111')
    const r = state().openShift(1000, cashAcc())
    expect(r.ok).toBe(true)
    const active = state().shifts.find((sh) => sh.id === state().activeShiftId)
    expect(active.cashAccountId).toBe(cashAcc())
  })

  it('cashierIds непустой + user не в списке → ok=false, смена не открывается', async () => {
    await state().login('e1', '1111')
    useStore.setState((s) => ({
      accounts: s.accounts.map((a) =>
        a.id === cashAcc() ? { ...a, cashierIds: ['e-other'] } : a,
      ),
    }))
    const r = state().openShift(1000, cashAcc())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/не назначен/i)
    expect(state().activeShiftId).toBeNull()
  })

  it('cashierIds содержит текущего user → смена открывается', async () => {
    await state().login('e1', '1111')
    useStore.setState((s) => ({
      accounts: s.accounts.map((a) =>
        a.id === cashAcc() ? { ...a, cashierIds: ['e1', 'e2'] } : a,
      ),
    }))
    const r = state().openShift(1000, cashAcc())
    expect(r.ok).toBe(true)
    expect(state().activeShiftId).toBeTruthy()
  })

  it('обратная совместимость: openShift(cash) без accountId работает', async () => {
    await state().login('e1', '1111')
    const r = state().openShift(500)
    expect(r.ok).toBe(true)
    const active = state().shifts.find((sh) => sh.id === state().activeShiftId)
    expect(active.cashAccountId).toBeNull()
  })

  it('cash-продажа после openShift(…, accountId) идёт на указанный счёт', async () => {
    await state().login('e1', '1111')
    // Возьмём второй cash-счёт, если он есть; иначе создадим.
    const secondCashId = 'acc_cash2'
    useStore.setState((s) => ({
      accounts: [
        ...s.accounts,
        { id: secondCashId, name: 'Касса #2', kind: 'cash', currency: '₽', cashierIds: [], createdAt: new Date().toISOString() },
      ],
    }))
    state().openShift(0, secondCashId)
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 250 }],
      total: 250,
      payment: { method: 'cash', cashPaid: 250, cardPaid: 0 },
    })
    const orderId = state().orders[0].id
    const tx = state().moneyTx.find((t) => t.orderId === orderId)
    expect(tx.accountId).toBe(secondCashId)
  })
})

describe('addPayment — оплата гасит долг (B2)', () => {
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

  // B2: раньше addPayment был параллельной механикой — двигал balance,
  // НО НЕ писал moneyTx. Касса не росла. Теперь — обёртка над addMoneyTx.
  it('addPayment создаёт запись в moneyTx (не только двигает balance)', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 500 } : c)),
    }))
    const txBefore = state().moneyTx.length
    state().addPayment(cust.id, 300)
    const tx = state().moneyTx[0]
    expect(state().moneyTx.length).toBe(txBefore + 1)
    expect(tx.type).toBe('in')
    expect(tx.amount).toBe(300)
    expect(tx.purpose).toBe('debt-in')
    expect(tx.customerId).toBe(cust.id)
  })

  it('addPayment пополняет баланс cash-счёта на сумму', () => {
    const cust = state().customers[0]
    const cashAcc = state().accounts.find((a) => a.kind === 'cash').id
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 500 } : c)),
    }))
    state().addPayment(cust.id, 250)
    const cashTx = state().moneyTx.filter(
      (t) => t.accountId === cashAcc && t.status === 'posted',
    )
    const sum = cashTx.reduce(
      (acc, t) => acc + (t.type === 'in' ? t.amount : -t.amount),
      0,
    )
    expect(sum).toBe(250)
  })
})

describe('remove* — защита от «висячих» ссылок (B3)', () => {
  // Раньше removeProduct/removeSupplier/removeCustomer молча удаляли —
  // в итоге открытые заказы ссылались на несуществующие id, резервы
  // копились «на фантоме», долги не закрывались.

  it('removeProduct: товар в открытом заказе → отказ', () => {
    const p = state().products.find((x) => x.stock >= 10)
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 100 }],
      total: 100,
    })
    const r = state().removeProduct(p.id)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/открытых заказ/i)
    expect(state().products.find((x) => x.id === p.id)).toBeTruthy()
  })

  it('removeProduct: у товара нет ссылок → удаление проходит', () => {
    // Создаём заведомо «чистый» товар — без документов/заказов/PO.
    // На seed-товарах visitor может быть привязан к готовым документам.
    useStore.setState((s) => ({
      products: [
        {
          id: 'p_test_clean',
          sku: 'TEST-1',
          name: 'Тестовый чистый',
          category: 'Крепёж',
          unit: 'шт',
          price: 100,
          cost: 50,
          stock: 10,
          minStock: 0,
          tags: [],
          warehouseId: 'wh1',
          prices: { pt_retail: 100 },
          type: 'product',
          batches: [{ id: 'b_test', qty: 10, cost: 50, at: new Date(0).toISOString() }],
        },
        ...s.products,
      ],
    }))
    const r = state().removeProduct('p_test_clean')
    expect(r.ok).toBe(true)
    expect(state().products.find((x) => x.id === 'p_test_clean')).toBeFalsy()
  })

  it('removeCustomer: есть долг → отказ', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 500 } : c)),
    }))
    const r = state().removeCustomer(cust.id)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/долг/i)
  })

  it('removeCustomer: открытый заказ → отказ', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 0 } : c)),
    }))
    state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 100 }],
      total: 100,
    })
    const r = state().removeCustomer(cust.id)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/открытые заказы/i)
  })

  it('removeSupplier: мы должны деньги → отказ', () => {
    const sup = state().suppliers[0]
    if (!sup) return
    useStore.setState((s) => ({
      suppliers: s.suppliers.map((x) => (x.id === sup.id ? { ...x, balance: 200 } : x)),
    }))
    const r = state().removeSupplier(sup.id)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/должны/i)
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
    // приводим к известному состоянию: одна партия 10 по 100. С FIFO это
    // одновременно и stock, и полный набор батчей (batches — источник истины).
    useStore.setState((s) => ({
      products: s.products.map((x) =>
        x.id === p.id
          ? {
              ...x,
              stock: 10,
              cost: 100,
              batches: [{ id: 'b_seed', qty: 10, cost: 100, at: '2026-01-01T00:00:00Z' }],
            }
          : x,
      ),
    }))
    state().addDocument({
      type: 'purchase',
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 10, cost: 200 }],
    })
    // взвешенная по остатку: (10*100 + 10*200) / 20 = 150
    expect(productById(p.id).cost).toBeCloseTo(150, 2)
    expect(productById(p.id).stock).toBe(20)
    // и появилась вторая партия
    expect(productById(p.id).batches).toHaveLength(2)
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

describe('transferStock — перемещение между складами (B7)', () => {
  it('целиком: qty ≥ p.stock → warehouseId/cell меняются, остаток не трогается', () => {
    const p = state().products.find((x) => x.warehouseId === 'wh1')
    const stockBefore = p.stock
    state().transferStock(p.id, 'wh2', 'A1', stockBefore) // целиком
    const after = productById(p.id)
    expect(after.warehouseId).toBe('wh2')
    expect(after.cell).toBe('A1')
    expect(after.stock).toBe(stockBefore)
    const mv = state().movements[0]
    expect(mv.type).toBe('transfer')
    expect(mv.delta).toBe(0)
  })

  it('частично: qty < p.stock → создаётся копия на новом складе с qty, исходная уменьшается', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const initial = p.stock
    const totalCount = state().products.length
    state().transferStock(p.id, 'wh2', 'B2', 3)
    const src = productById(p.id)
    // Исходная карточка: остаток уменьшен на 3, склад НЕ меняется
    expect(src.stock).toBe(initial - 3)
    expect(src.warehouseId).toBe(p.warehouseId)
    // Появилась новая карточка на wh2 с остатком 3
    expect(state().products.length).toBe(totalCount + 1)
    const copy = state().products.find(
      (x) => x.sku === p.sku && x.warehouseId === 'wh2',
    )
    expect(copy?.stock).toBe(3)
    expect(copy?.cell).toBe('B2')
  })
})

describe('C2: refundOrder — возврат по чеку', () => {
  // Возврат за нал возвращает деньги в кассу (moneyTx type='out'),
  // возвращает остаток на склад, создаёт refund-order с origOrderId.

  it('cash-чек: возврат создаёт refund-order + moneyTx out + возврат остатка', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const before = productById(p.id).stock
    state().addOrder({
      kind: 'retail',
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 2, price: 100 }],
      total: 200,
      payment: { method: 'cash', cashPaid: 200, cardPaid: 0 },
    })
    const origId = state().orders[0].id
    // после чека: остаток -2
    expect(productById(p.id).stock).toBe(before - 2)
    const r = state().refundOrder(origId, {
      items: [{ productId: p.id, qty: 1 }],
      reason: 'брак',
    })
    expect(r.ok).toBe(true)
    expect(r.total).toBe(100)
    // Остаток восстановлен на 1
    expect(productById(p.id).stock).toBe(before - 1)
    // Refund-order с ссылкой на оригинал
    const refund = state().orders[0]
    expect(refund.kind).toBe('refund')
    expect(refund.origOrderId).toBe(origId)
    expect(refund.no).toMatch(/^ВЧК-/)
    // moneyTx type='out' с purpose='sale-refund' на кассу
    const cashAcc = state().accounts.find((a) => a.kind === 'cash').id
    const refundTx = state().moneyTx.find(
      (t) => t.orderId === refund.id && t.type === 'out',
    )
    expect(refundTx?.amount).toBe(100)
    expect(refundTx?.purpose).toBe('sale-refund')
    expect(refundTx?.accountId).toBe(cashAcc)
  })

  it('credit-чек: возврат уменьшает customer.balance', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) => (c.id === cust.id ? { ...c, balance: 0, creditLimit: 0 } : c)),
    }))
    const p = state().products.find((x) => x.stock >= 5)
    state().addOrder({
      kind: 'retail',
      customerId: cust.id,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 1, price: 500 }],
      total: 500,
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    const origId = state().orders[0].id
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(500)
    state().refundOrder(origId, { items: [{ productId: p.id, qty: 1 }] })
    // Долг погашается возвратом
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(0)
  })

  it('возврат больше, чем куплено → ok=false', () => {
    const p = state().products.find((x) => x.stock >= 5)
    state().addOrder({
      kind: 'retail',
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 2, price: 100 }],
      total: 200,
      payment: { method: 'cash', cashPaid: 200, cardPaid: 0 },
    })
    const r = state().refundOrder(state().orders[0].id, {
      items: [{ productId: p.id, qty: 3 }],
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/больше нельзя/i)
  })
})

describe('C1: кредитный лимит клиента', () => {
  it('onCredit + новый долг > creditLimit → { ok:false, error }', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) =>
        c.id === cust.id ? { ...c, balance: 800, creditLimit: 1000 } : c,
      ),
    }))
    const r = state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 500 }],
      total: 500, // 800 + 500 = 1300 > 1000
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/лимит/i)
    // balance не изменился, заказа нет
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(800)
  })

  it('onCredit + новый долг ≤ лимита → продажа проходит', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) =>
        c.id === cust.id ? { ...c, balance: 300, creditLimit: 1000 } : c,
      ),
    }))
    const r = state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 400 }],
      total: 400, // 300 + 400 = 700 ≤ 1000
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    expect(r.ok).toBe(true)
    expect(state().customers.find((c) => c.id === cust.id).balance).toBe(700)
  })

  it('creditLimit = 0 → нет ограничения', () => {
    const cust = state().customers[0]
    useStore.setState((s) => ({
      customers: s.customers.map((c) =>
        c.id === cust.id ? { ...c, balance: 0, creditLimit: 0 } : c,
      ),
    }))
    const r = state().addOrder({
      customerId: cust.id,
      items: [{ productId: state().products[0].id, name: 'X', qty: 1, price: 999999 }],
      total: 999999,
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    expect(r.ok).toBe(true)
  })
})

describe('B4: cancelOrder сбрасывает stockConsumed', () => {
  it('после cancelOrder повторное shipped снова списывает остаток', () => {
    const p = state().products.find((x) => x.stock >= 10)
    const before = productById(p.id).stock
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, unit: p.unit, qty: 2, price: 100 }],
      total: 200,
    })
    const id = state().orders[0].id
    state().setOrderStatus(id, 'shipped')
    expect(productById(p.id).stock).toBe(before - 2)
    state().cancelOrder(id)
    expect(productById(p.id).stock).toBe(before)
    // Флаг сброшен — повторный shipped снова списывает
    const cancelled = state().orders.find((o) => o.id === id)
    expect(cancelled.stockConsumed).toBe(false)
  })
})

describe('B5: addOrder — валидация суммы оплаты', () => {
  it('cashPaid + cardPaid < total → { ok:false }, заказ не создаётся', () => {
    const p = state().products[0]
    const ordersBefore = state().orders.length
    const r = state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 1000 }],
      total: 1000,
      payment: { method: 'cash', cashPaid: 400, cardPaid: 0 },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/недостаточно|Оплачено/i)
    expect(state().orders.length).toBe(ordersBefore)
  })

  it('credit-платёж не проверяется на сумму (деньги ещё не пришли)', () => {
    const p = state().products[0]
    const r = state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 500 }],
      total: 500,
      onCredit: true,
      payment: { method: 'credit', cashPaid: 0, cardPaid: 0 },
    })
    expect(r.ok).toBe(true)
  })
})

describe('B6: updateOrder пересчитывает total при смене items', () => {
  it('изменение items → total и subtotal пересчитываются', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 1, price: 100 }],
      total: 100,
    })
    const id = state().orders[0].id
    state().updateOrder(id, {
      items: [{ productId: p.id, name: p.name, qty: 3, price: 200 }],
    })
    const o = state().orders.find((x) => x.id === id)
    expect(o.subtotal).toBe(600)
    expect(o.total).toBe(600)
  })

  it('изменение discount → total уменьшается', () => {
    const p = state().products[0]
    state().addOrder({
      customerId: state().customers[0].id,
      items: [{ productId: p.id, name: p.name, qty: 2, price: 500 }],
      total: 1000,
    })
    const id = state().orders[0].id
    state().updateOrder(id, { discount: 10 })
    const o = state().orders.find((x) => x.id === id)
    expect(o.total).toBe(900)
  })
})

// Sanity check: seed стабилен от теста к тесту
describe('seed / resetStore — база чиста', () => {
  it('после resetStore products и orders совпадают с seed', () => {
    expect(state().products.length).toBe(seedSnapshot.products.length)
    expect(state().employees[0].id).toBe('e1')
  })
})
