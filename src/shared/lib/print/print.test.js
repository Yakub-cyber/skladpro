import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  rublesToWords, splitVat, plural,
  sellerRequisites, buyerRequisites, itemFinancials,
  printInvoiceBill, printInvoiceTORG12, printInvoiceUPD,
} from './print'

describe('rublesToWords — сумма прописью', () => {
  it('ноль', () => {
    expect(rublesToWords(0)).toBe('Ноль рублей 00 копеек')
  })
  it('рубли и копейки с правильными склонениями', () => {
    expect(rublesToWords(1)).toBe('Один рубль 00 копеек')
    expect(rublesToWords(2)).toBe('Два рубля 00 копеек')
    expect(rublesToWords(5)).toBe('Пять рублей 00 копеек')
    expect(rublesToWords(21)).toBe('Двадцать один рубль 00 копеек')
  })
  it('копейки', () => {
    expect(rublesToWords(123.45)).toBe('Сто двадцать три рубля 45 копеек')
    expect(rublesToWords(0.01)).toBe('Ноль рублей 01 копейка')
  })
  it('тысячи — женский род', () => {
    expect(rublesToWords(1000)).toBe('Одна тысяча рублей 00 копеек')
    expect(rublesToWords(2000)).toBe('Две тысячи рублей 00 копеек')
    expect(rublesToWords(5000)).toBe('Пять тысяч рублей 00 копеек')
  })
  it('составные суммы', () => {
    expect(rublesToWords(12500.5)).toBe('Двенадцать тысяч пятьсот рублей 50 копеек')
    expect(rublesToWords(1234567)).toBe(
      'Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь рублей 00 копеек',
    )
  })
  it('округляет копейки', () => {
    expect(rublesToWords(99.999)).toBe('Сто рублей 00 копеек')
  })
})

describe('splitVat — разбивка НДС', () => {
  it('выделяет НДС 20% из суммы с налогом', () => {
    const { net, vat, rate } = splitVat(120, 20)
    expect(net).toBe(100)
    expect(vat).toBe(20)
    expect(rate).toBe(20)
  })
  it('НДС 10%', () => {
    const { net, vat } = splitVat(110, 10)
    expect(net).toBe(100)
    expect(vat).toBe(10)
  })
  it('без НДС (rate=0)', () => {
    expect(splitVat(1000, 0)).toEqual({ net: 1000, vat: 0, rate: 0 })
  })
  it('net + vat == total', () => {
    const t = 15499.99
    const { net, vat } = splitVat(t, 20)
    expect(Math.round((net + vat) * 100) / 100).toBe(t)
  })
})

describe('plural', () => {
  it('выбирает форму по числу', () => {
    const f = ['товар', 'товара', 'товаров']
    expect(plural(1, f)).toBe('товар')
    expect(plural(2, f)).toBe('товара')
    expect(plural(5, f)).toBe('товаров')
    expect(plural(11, f)).toBe('товаров')
    expect(plural(21, f)).toBe('товар')
    expect(plural(112, f)).toBe('товаров')
  })
})

describe('sellerRequisites / buyerRequisites — сборка строки реквизитов', () => {
  it('собирает продавца из ИНН/КПП/адрес/банк', () => {
    const s = sellerRequisites({
      inn: '7701234567', kpp: '770101001', address: 'Москва, ул. Ленина, 1',
      bank: 'ПАО Сбербанк', bik: '044525225', account: '40702810900000000001',
    })
    expect(s).toContain('ИНН 7701234567')
    expect(s).toContain('КПП 770101001')
    expect(s).toContain('Москва')
    expect(s).toContain('БИК 044525225')
  })

  it('пустые реквизиты → название компании как fallback', () => {
    const s = sellerRequisites({}, { company: 'ИП Иванов' })
    expect(s).toBe('ИП Иванов')
  })

  it('покупатель: ИНН/КПП/адрес', () => {
    const b = buyerRequisites({ inn: '1234567890', address: 'СПб' })
    expect(b).toBe('ИНН 1234567890 · СПб')
  })
})

describe('itemFinancials — разложение строки на net/vat/gross', () => {
  it('net + vat === gross (НДС 20%)', () => {
    const f = itemFinancials({ qty: 2, price: 120 }, 20)
    expect(f.qty).toBe(2)
    expect(f.gross).toBe(240)
    expect(f.net + f.vat).toBeCloseTo(240, 2)
    expect(f.priceNet).toBeCloseTo(100, 2)
  })

  it('без НДС (rate=0): net === gross, vat=0', () => {
    const f = itemFinancials({ qty: 3, price: 50 }, 0)
    expect(f.net).toBe(150)
    expect(f.vat).toBe(0)
    expect(f.priceNet).toBe(50)
  })

  it('нулевое qty не делит на ноль', () => {
    const f = itemFinancials({ qty: 0, price: 100 }, 20)
    expect(f.priceNet).toBe(0)
    expect(f.gross).toBe(0)
  })
})

// Печатные формы: проверяем, что HTML собирается без ошибок и содержит
// обязательные реквизиты. Полный визуальный контроль — руками через print.
describe('printInvoiceBill / TORG12 / UPD — сборка HTML', () => {
  let openedHtml
  beforeEach(() => {
    openedHtml = ''
    globalThis.window = {
      open: () => ({
        document: {
          write: (h) => { openedHtml += h },
          close: () => {},
        },
      }),
    }
  })
  afterEach(() => {
    delete globalThis.window
  })

  const order = {
    no: 'ЗК-000101',
    createdAt: '2026-07-14T10:00:00Z',
    customerName: 'ООО «Ромашка»',
    items: [
      { name: 'Гвозди 100мм', unit: 'кг', qty: 5, price: 240 },
      { name: 'Молоток слесарный', unit: 'шт', qty: 2, price: 720 },
    ],
    total: 240 * 5 + 720 * 2,
  }
  const settings = {
    company: 'ООО «СкладПро»',
    currency: '₽',
    requisites: {
      name: 'ООО «СкладПро»',
      inn: '7701234567', kpp: '770101001',
      address: 'Москва, ул. Тестовая, 1',
      vatRate: 20,
      director: 'Иванов И.И.',
      accountant: 'Петрова А.С.',
    },
  }
  const customer = { name: 'ООО «Ромашка»', inn: '5001234567', address: 'МО, Балашиха' }

  it('«Счёт на оплату» содержит номер, стороны, суммы и подпись', () => {
    printInvoiceBill(order, { settings, customer })
    expect(openedHtml).toContain('Счёт на оплату № ЗК-000101')
    expect(openedHtml).toContain('ООО «Ромашка»')
    expect(openedHtml).toContain('НДС 20%')
    expect(openedHtml).toContain('ИНН 7701234567')
    expect(openedHtml).toContain('Иванов И.И.')
  })

  it('ТОРГ-12 содержит грузоотправителя/получателя, ставки НДС и итог прописью', () => {
    printInvoiceTORG12(order, { settings, customer })
    expect(openedHtml).toContain('ТОРГ-12')
    expect(openedHtml).toContain('Товарная накладная № ЗК-000101')
    expect(openedHtml).toContain('Грузоотправитель')
    expect(openedHtml).toContain('Грузополучатель')
    // 5 + 2 = 7 позиций количества
    expect(openedHtml).toContain('7,00') // qty итог
    // Итог с НДС === order.total (2640). Intl использует неразрывный
    // пробел как разделитель разрядов — нормализуем оба варианта.
    const flat = openedHtml.replace(/[\s\u00a0\u202f]+/g, ' ')
    expect(flat).toContain('2 640,00')
    // Сумма прописью
    expect(openedHtml).toContain('Две тысячи шестьсот сорок')
  })

  it('УПД (статус 1) явно помечен и содержит колонку страны', () => {
    printInvoiceUPD(order, { settings, customer })
    expect(openedHtml).toContain('Универсальный передаточный документ')
    expect(openedHtml).toContain('Статус')
    expect(openedHtml).toContain('счёт-фактура и первичный документ')
    expect(openedHtml).toContain('Страна')
    expect(openedHtml).toContain('Товар (груз) передал')
  })

  it('формы работают без customer (например, розничная продажа)', () => {
    printInvoiceBill(order, { settings })
    expect(openedHtml).toContain('ЗК-000101') // не роняется на customer=null
  })
})
