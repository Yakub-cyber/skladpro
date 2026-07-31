import { describe, it, expect } from 'vitest'
import { buildAssistantContext, buildAssistantPrompt } from './assistant'

const state = () => ({
  products: [
    { id: 'p1', name: 'Гвозди', sku: 'GV-1', stock: 5, minStock: 20, unit: 'кг', cost: 10, price: 18, cell: 'A1', category: 'Крепёж' },
    { id: 'p2', name: 'Молоток', sku: 'ML-1', stock: 50, minStock: 5, unit: 'шт', cost: 200, price: 350 },
    { id: 'p3', name: 'Скотч', sku: 'SK-1', stock: 100, minStock: 10, unit: 'шт', cost: 30, price: 60 },
  ],
  orders: [
    { id: 'o1', no: 'ЗК-101', customerName: 'ООО Ромашка', total: 5000, status: 'delivered', items: [{ productId: 'p2', qty: 3 }] },
    { id: 'o2', no: 'ЗК-102', customerName: 'ИП Иванов', total: 1200, status: 'cancelled', items: [{ productId: 'p1', qty: 10 }] },
  ],
  customers: [
    { id: 'c1', name: 'ООО Ромашка', balance: 15000 },
    { id: 'c2', name: 'ИП Иванов', balance: 0 },
  ],
})

describe('buildAssistantContext', () => {
  const ctx = buildAssistantContext(state())

  it('включает сводку с числом товаров и выручкой (без отменённых)', () => {
    expect(ctx).toContain('товаров 3')
    expect(ctx).toContain('выручка 5000') // отменённый заказ не считается
  })

  it('выделяет позиции ниже минимума', () => {
    expect(ctx).toContain('НИЖЕ МИНИМУМА')
    expect(ctx).toContain('Гвозди: 5 кг (мин 20)')
  })

  it('показывает топ продаж по фактическим отгрузкам', () => {
    expect(ctx).toContain('ТОП ПРОДАЖ')
    expect(ctx).toContain('Молоток: продано 3')
  })

  it('перечисляет должников с суммой', () => {
    expect(ctx).toContain('ДОЛЖНИКИ')
    expect(ctx).toContain('ООО Ромашка: долг 15000')
    expect(ctx).not.toContain('ИП Иванов: долг') // нулевой долг не попадает
  })

  it('включает каталог с остатками и себестоимостью', () => {
    expect(ctx).toContain('КАТАЛОГ')
    expect(ctx).toContain('Гвозди [GV-1]')
    expect(ctx).toContain('себест. 10')
  })

  it('показывает резерв и доступное, не выдавая зарезервированное за остаток', () => {
    const s = {
      products: [{ id: 'p1', name: 'Гвозди', sku: 'GV-1', stock: 100, minStock: 5, unit: 'шт', cost: 10, price: 18 }],
      orders: [{ id: 'o1', status: 'picking', items: [{ productId: 'p1', qty: 30 }] }],
      customers: [],
    }
    const c = buildAssistantContext(s)
    expect(c).toContain('резерв 30, доступно 70') // в каталоге виден резерв
  })

  it('отмечает усечение при большом каталоге', () => {
    const big = { products: Array.from({ length: 100 }, (_, i) => ({ id: 'p' + i, name: 'Товар ' + i, stock: 1, unit: 'шт' })), orders: [], customers: [] }
    const c = buildAssistantContext(big, { maxProducts: 80 })
    expect(c).toContain('и ещё 20 товаров')
  })

  it('не падает на пустом состоянии', () => {
    expect(() => buildAssistantContext({})).not.toThrow()
  })
})

describe('buildAssistantPrompt', () => {
  it('склеивает инструкцию, контекст и вопрос', () => {
    const p = buildAssistantPrompt('КОНТЕКСТ-ТУТ', 'Сколько гвоздей?')
    expect(p).toContain('ассистент склад')
    expect(p).toContain('КОНТЕКСТ-ТУТ')
    expect(p).toContain('Сколько гвоздей?')
  })
})
