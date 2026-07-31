import {
  Wrench,
  Hammer,
  Zap,
  Droplets,
  PaintBucket,
  Package,
} from 'lucide-react'

export const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

export const stockTone = (p) =>
  p.stock <= p.minStock ? 'bad' : p.stock <= p.minStock * 1.5 ? 'warn' : 'ok'

// Пустой набор фильтров — по нему сбрасываем панель к дефолту.
// Формат «Цена/Остатки» — оператор + значение (как в CloudShop):
// priceOp ∈ '>', '<', '=' + priceVal — число или пусто (не фильтруем).
export const EMPTY_FILTERS = {
  priceOp: '>',
  priceVal: '',
  stockOp: '>',
  stockVal: '',
  stockStatus: 'any', // any | low (ниже min) | out (0) | in
  weighted: 'any',
  marked: 'any',
}

// Ключи в localStorage для пресетов фильтров и настроек колонок.
export const LS_PRESETS = 'sklad.products.filterPresets'
export const LS_COLS = 'sklad.products.visibleCols'

// Дефолтный набор видимых колонок (CloudShop-эталон).
export const DEFAULT_COLS = {
  image: true,      // Фото
  sku: true,        // Артикул / Код
  category: true,   // Категория
  unit: false,      // Ед. изм.
  minStock: true,   // Мин.
  reserved: true,   // Резерв
  available: true,  // Доступно
  cost: true,       // Себестоимость
  price: true,      // Цена
  margin: false,    // Маржа (price − cost)
  cell: true,       // Ячейка
  stock: true,      // Остаток
}

// Применение операторного фильтра. op ∈ '>', '<', '='; val — число или пусто.
export function applyOp(value, op, val) {
  if (val === '' || val == null) return true
  const v = Number(value) || 0
  const t = Number(val)
  if (op === '>') return v > t
  if (op === '<') return v < t
  return v === t
}

export const PAGE_SIZE = 100
