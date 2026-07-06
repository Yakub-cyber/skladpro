import { describe, it, expect } from 'vitest'
import {
  parseInvoiceText,
  matchProduct,
  buildPickRoute,
  analyticsInsights,
  soldByProduct,
} from './ai'

const CATALOG = [
  { id: 'p1', name: 'Гвозди строительные', sku: 'GVZ-100', unit: 'кг', price: 90, tags: ['крепёж'] },
  { id: 'p2', name: 'Молоток слесарный', sku: 'MOL-05', unit: 'шт', price: 450, tags: ['инструмент'] },
  { id: 'p3', name: 'Саморез по дереву', sku: 'SAM-35', unit: 'шт', price: 2, tags: ['крепёж'] },
]

describe('parseInvoiceText — накладная из текста', () => {
  it('разбирает несколько позиций с количеством и единицами', () => {
    const items = parseInvoiceText('Гвозди 100 кг\nМолоток 5 шт', CATALOG)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ qty: 100, unit: 'кг' })
    expect(items[1]).toMatchObject({ qty: 5, unit: 'шт' })
  })

  it('сопоставляет позицию с товаром из каталога', () => {
    const [it] = parseInvoiceText('гвозди строительные 50 кг', CATALOG)
    expect(it.matched).toBe(true)
    expect(it.productId).toBe('p1')
    expect(it.confidence).toBeGreaterThan(0)
  })

  it('не путает размер (3.5x40) с количеством', () => {
    const [it] = parseInvoiceText('Саморез 3.5x40 200 шт', CATALOG)
    expect(it.qty).toBe(200)
    expect(it.name).toMatch(/3\.5x40/)
  })

  it('объединяет дубликаты одной позиции', () => {
    const items = parseInvoiceText('Гвозди 100 кг\nГвозди 50 кг', CATALOG)
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(150)
  })

  it('пустой ввод даёт пустой список', () => {
    expect(parseInvoiceText('', CATALOG)).toEqual([])
    expect(parseInvoiceText('   ', CATALOG)).toEqual([])
  })

  it('количество по умолчанию = 1, если не указано', () => {
    const [it] = parseInvoiceText('Молоток слесарный', CATALOG)
    expect(it.qty).toBe(1)
  })
})

describe('matchProduct — сопоставление с каталогом', () => {
  it('находит товар по артикулу', () => {
    const m = matchProduct('GVZ-100', CATALOG)
    expect(m?.product.id).toBe('p1')
  })

  it('возвращает null для нерелевантного запроса', () => {
    expect(matchProduct('квадрокоптер космический', CATALOG)).toBeNull()
  })
})

describe('buildPickRoute — маршрут сборщика', () => {
  it('обходит все точки и считает дистанцию', () => {
    const pts = [
      { x: 3, y: 0, id: 'a' },
      { x: 1, y: 0, id: 'b' },
      { x: 5, y: 0, id: 'c' },
    ]
    const { order, distance } = buildPickRoute(pts, { x: 0, y: 0 })
    expect(order).toHaveLength(3)
    expect(order[0].id).toBe('b') // ближайшая к старту
    expect(distance).toBeGreaterThan(0)
  })

  it('пустой список — нулевой маршрут', () => {
    expect(buildPickRoute([], { x: 0, y: 0 })).toEqual({ order: [], distance: 0 })
  })
})

describe('soldByProduct / analyticsInsights', () => {
  const orders = [
    { status: 'delivered', items: [{ productId: 'p1', qty: 20 }, { productId: 'p2', qty: 2 }] },
    { status: 'new', items: [{ productId: 'p1', qty: 10 }] },
    { status: 'cancelled', items: [{ productId: 'p1', qty: 999 }] }, // не учитывается
  ]

  it('суммирует продажи, игнорируя отменённые заказы', () => {
    const sold = soldByProduct(orders)
    expect(sold.p1).toBe(30)
    expect(sold.p2).toBe(2)
  })

  it('даёт инсайт о позициях ниже минимума', () => {
    const products = [
      { id: 'p1', name: 'Гвозди', stock: 1, minStock: 10, cost: 50, unit: 'кг' },
      { id: 'p2', name: 'Молоток', stock: 100, minStock: 5, cost: 300, unit: 'шт' },
    ]
    const insights = analyticsInsights({ products, orders })
    expect(insights.some((i) => i.id === 'low')).toBe(true)
  })
})
