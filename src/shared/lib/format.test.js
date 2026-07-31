import { describe, it, expect } from 'vitest'
import { plural } from './format'
import { nextNo } from './id'

describe('plural — русское склонение', () => {
  // Старая сигнатура — сохраняем обратную совместимость с print.js
  // и оставшимися вызовами `plural(n, 'a','b','c')`.
  it('старый API: plural(n, one, few, many)', () => {
    expect(plural(1, 'товар', 'товара', 'товаров')).toBe('товар')
    expect(plural(2, 'товар', 'товара', 'товаров')).toBe('товара')
    expect(plural(5, 'товар', 'товара', 'товаров')).toBe('товаров')
    expect(plural(11, 'товар', 'товара', 'товаров')).toBe('товаров')
    expect(plural(21, 'товар', 'товара', 'товаров')).toBe('товар')
  })

  // Новый API: массив. Тот, что в Layout.jsx/DashboardCourier/
  // DashboardStock — раньше падал на «undefined» из-за игнорирования массива.
  it('новый API: plural(n, [one, few, many])', () => {
    const forms = ['точка', 'точки', 'точек']
    expect(plural(1, forms)).toBe('точка')
    expect(plural(2, forms)).toBe('точки')
    expect(plural(3, forms)).toBe('точки')
    expect(plural(5, forms)).toBe('точек')
    expect(plural(0, forms)).toBe('точек')
    expect(plural(11, forms)).toBe('точек')
    expect(plural(101, forms)).toBe('точка')
  })
})

describe('nextNo — уникальные номера документов', () => {
  const y = new Date().getFullYear()

  it('пустая коллекция → …-0001', () => {
    expect(nextNo([], 'ЗК')).toBe(`ЗК-${y}-0001`)
  })

  it('max + 1 (а не length + 1)', () => {
    const col = [
      { no: `ЗК-${y}-0005` },
      { no: `ЗК-${y}-0002` },
      { no: `ЗК-${y}-0003` },
    ]
    expect(nextNo(col, 'ЗК')).toBe(`ЗК-${y}-0006`)
  })

  it('игнорирует чужой префикс и другой год', () => {
    const col = [
      { no: `ЧК-${y}-0099` },
      { no: `ЗК-2023-9999` },
      { no: `ЗК-${y}-0007` },
    ]
    expect(nextNo(col, 'ЗК')).toBe(`ЗК-${y}-0008`)
  })

  it('cancelled/удалённые не сбрасывают счётчик (max по no сохраняется)', () => {
    const col = [
      { no: `ЗК-${y}-0010`, status: 'cancelled' },
      { no: `ЗК-${y}-0009`, status: 'new' },
    ]
    expect(nextNo(col, 'ЗК')).toBe(`ЗК-${y}-0011`)
  })
})
