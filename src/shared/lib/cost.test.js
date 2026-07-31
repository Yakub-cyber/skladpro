import { describe, it, expect } from 'vitest'
import { weightedCost } from './cost'

describe('weightedCost — средневзвешенная себестоимость', () => {
  it('усредняет старую и новую цену по количеству', () => {
    // было 100 шт по 10 ₽, пришло 100 шт по 20 ₽ → 15 ₽
    expect(weightedCost(100, 10, 100, 20)).toBe(15)
  })

  it('учитывает разные объёмы', () => {
    // 10 шт по 10 + 90 шт по 20 = (100 + 1800)/100 = 19
    expect(weightedCost(10, 10, 90, 20)).toBe(19)
  })

  it('пустой склад → берёт цену прихода', () => {
    expect(weightedCost(0, 0, 50, 33)).toBe(33)
    expect(weightedCost(0, 999, 50, 33)).toBe(33) // старая цена не влияет
  })

  it('цена прихода не указана → себестоимость не меняется', () => {
    expect(weightedCost(100, 12, 50, null)).toBe(12)
    expect(weightedCost(100, 12, 50, '')).toBe(12)
    expect(weightedCost(100, 12, 50, undefined)).toBe(12)
  })

  it('нулевой приход → без изменений', () => {
    expect(weightedCost(100, 12, 0, 20)).toBe(12)
  })

  it('округляет до копеек', () => {
    // (1*10 + 2*15)/3 = 13.333… → 13.33
    expect(weightedCost(1, 10, 2, 15)).toBe(13.33)
  })

  it('цена прихода 0 учитывается (бесплатная партия снижает себестоимость)', () => {
    // 100 по 10 + 100 по 0 → 5
    expect(weightedCost(100, 10, 100, 0)).toBe(5)
  })
})
