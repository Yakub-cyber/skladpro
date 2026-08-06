import { describe, it, expect } from 'vitest'
import { unitFactor, normalizeItemQty, normalizeItems } from './units'

const cola = {
  id: 'cola',
  unit: 'шт',
  units: [
    { unit: 'шт', factor: 1 },
    { unit: 'уп', factor: 12 },
    { unit: 'кор', factor: 144 },
  ],
}

const simple = { id: 'bolt', unit: 'шт' }

describe('unitFactor', () => {
  it('базовая единица → 1', () => {
    expect(unitFactor(cola, 'шт')).toBe(1)
  })
  it('упаковка → 12', () => {
    expect(unitFactor(cola, 'уп')).toBe(12)
  })
  it('коробка → 144', () => {
    expect(unitFactor(cola, 'кор')).toBe(144)
  })
  it('неизвестная единица → 1', () => {
    expect(unitFactor(cola, 'пал')).toBe(1)
  })
  it('товар без units → 1', () => {
    expect(unitFactor(simple, 'уп')).toBe(1)
  })
  it('null/undefined → 1', () => {
    expect(unitFactor(null, 'уп')).toBe(1)
    expect(unitFactor(cola, null)).toBe(1)
  })
})

describe('normalizeItemQty', () => {
  it('базовая единица — без изменений', () => {
    const item = { productId: 'cola', qty: 20, unit: 'шт', price: 50 }
    const out = normalizeItemQty(item, cola)
    expect(out).toBe(item)
    expect(out.qty).toBe(20)
  })

  it('упаковка → qty * 12, оригинал сохранён', () => {
    const item = { productId: 'cola', qty: 20, unit: 'уп', price: 600 }
    const out = normalizeItemQty(item, cola)
    expect(out.qty).toBe(240)
    expect(out.inputQty).toBe(20)
    expect(out.inputUnit).toBe('уп')
    expect(out.unitFactor).toBe(12)
    expect(out.price).toBe(600)
  })

  it('коробка → qty * 144', () => {
    const item = { productId: 'cola', qty: 5, unit: 'кор' }
    const out = normalizeItemQty(item, cola)
    expect(out.qty).toBe(720)
    expect(out.unitFactor).toBe(144)
  })

  it('товар без units — без изменений', () => {
    const item = { productId: 'bolt', qty: 100, unit: 'шт' }
    const out = normalizeItemQty(item, simple)
    expect(out).toBe(item)
  })
})

describe('normalizeItemQty — идемпотентность', () => {
  it('повторная нормализация не умножает дважды', () => {
    const item = { productId: 'cola', qty: 20, unit: 'уп' }
    const once = normalizeItemQty(item, cola)
    expect(once.qty).toBe(240)
    const twice = normalizeItemQty(once, cola)
    expect(twice.qty).toBe(240)
    expect(twice).toBe(once)
  })
})

describe('normalizeItems', () => {
  const products = [cola, simple]

  it('идемпотентна: повторный прогон не умножает дважды', () => {
    const items = [{ productId: 'cola', qty: 20, unit: 'уп' }]
    const once = normalizeItems(items, products)
    const twice = normalizeItems(once, products)
    expect(twice[0].qty).toBe(240)
  })

  it('нормализует каждую позицию по её товару', () => {
    const items = [
      { productId: 'cola', qty: 10, unit: 'уп' },
      { productId: 'bolt', qty: 50, unit: 'шт' },
    ]
    const out = normalizeItems(items, products)
    expect(out[0].qty).toBe(120)
    expect(out[1].qty).toBe(50)
  })

  it('товар не найден — qty без изменений', () => {
    const items = [{ productId: 'unknown', qty: 7, unit: 'уп' }]
    const out = normalizeItems(items, products)
    expect(out[0].qty).toBe(7)
  })
})
