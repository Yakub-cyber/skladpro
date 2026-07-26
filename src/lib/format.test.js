import { describe, it, expect } from 'vitest'
import { plural } from './format'

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
