import { describe, it, expect } from 'vitest'
import { rublesToWords, splitVat, plural } from './print'

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
