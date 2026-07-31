import { describe, it, expect } from 'vitest'
import { effectiveVat, extractVat, computeVatSummary } from './vat'

describe('effectiveVat — приоритет ставки', () => {
  it('явно на товаре → берём product.vatRate', () => {
    expect(effectiveVat({ vatRate: 10 }, { company: { vatRate: 20 } })).toBe(10)
    expect(effectiveVat({ vatRate: 0 }, {})).toBe(0)
  })

  it('пусто на товаре → fallback settings.company.vatRate', () => {
    expect(effectiveVat({}, { company: { vatRate: 10 } })).toBe(10)
    expect(effectiveVat({ vatRate: null }, { company: { vatRate: 10 } })).toBe(10)
  })

  it('пусто везде → 20% (стандарт РФ)', () => {
    expect(effectiveVat({}, {})).toBe(20)
    expect(effectiveVat({ vatRate: null }, { company: { vatRate: null } })).toBe(20)
  })
})

describe('extractVat — разложение gross на net+vat', () => {
  it('20% → 100→83.33 + 16.67', () => {
    const { net, vat } = extractVat(100, 20)
    expect(net).toBe(83.33)
    expect(vat).toBe(16.67)
  })

  it('10% → 110→100 + 10', () => {
    const { net, vat } = extractVat(110, 10)
    expect(net).toBe(100)
    expect(vat).toBe(10)
  })

  it('0% → gross = net, vat = 0', () => {
    const { net, vat } = extractVat(500, 0)
    expect(net).toBe(500)
    expect(vat).toBe(0)
  })
})

describe('computeVatSummary — свёртка по позициям чека', () => {
  const products = [
    { id: 'p1', vatRate: 20 },
    { id: 'p2', vatRate: 10 },
    { id: 'p3' }, // → fallback company (20%)
  ]

  it('mixed-ставки: агрегат + разбивка по rate', () => {
    const items = [
      { productId: 'p1', qty: 1, price: 100 }, // 20%
      { productId: 'p2', qty: 2, price: 55 }, // 110 всего под 10%
      { productId: 'p3', qty: 1, price: 100 }, // 20% (fallback)
    ]
    const s = computeVatSummary(items, products, {})
    expect(s.gross).toBe(310)
    expect(s.byRate.length).toBe(2)
    const rate20 = s.byRate.find((r) => r.rate === 20)
    const rate10 = s.byRate.find((r) => r.rate === 10)
    expect(rate20.gross).toBe(200)
    expect(rate10.gross).toBe(110)
    expect(rate10.vat).toBe(10)
  })

  it('пустой items → нули', () => {
    const s = computeVatSummary([], products, {})
    expect(s.gross).toBe(0)
    expect(s.vat).toBe(0)
    expect(s.byRate).toEqual([])
  })
})
