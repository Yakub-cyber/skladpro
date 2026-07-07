import { describe, it, expect } from 'vitest'
import { toCsv } from './export'

const cols = [
  { key: 'name', label: 'Название' },
  { key: 'stock', label: 'Остаток' },
]

describe('toCsv', () => {
  it('строит заголовок из label и строки из значений', () => {
    const rows = [{ name: 'Гвозди', stock: 100 }, { name: 'Молоток', stock: 5 }]
    expect(toCsv(rows, cols)).toBe('Название;Остаток\r\nГвозди;100\r\nМолоток;5')
  })

  it('использует ключ, если label не задан', () => {
    expect(toCsv([{ a: 1 }], [{ key: 'a' }])).toBe('a\r\n1')
  })

  it('пустые/undefined значения → пустая ячейка', () => {
    const rows = [{ name: null, stock: undefined }]
    expect(toCsv(rows, cols)).toBe('Название;Остаток\r\n;')
  })

  it('экранирует значения с разделителем, кавычками и переносами', () => {
    const rows = [{ name: 'Болт; гайка', stock: 'a"b' }]
    expect(toCsv(rows, cols)).toBe('Название;Остаток\r\n"Болт; гайка";"a""b"')
  })

  it('применяет map для вычисляемых столбцов', () => {
    const rows = [{ price: 100, qty: 3 }]
    const c = [{ key: 'sum', label: 'Сумма', map: (_, r) => r.price * r.qty }]
    expect(toCsv(rows, c)).toBe('Сумма\r\n300')
  })

  it('поддерживает свой разделитель', () => {
    expect(toCsv([{ a: 1, b: 2 }], [{ key: 'a' }, { key: 'b' }], { delimiter: ',' })).toBe('a,b\r\n1,2')
  })

  it('пустой список строк → только заголовок', () => {
    expect(toCsv([], cols)).toBe('Название;Остаток')
  })
})
