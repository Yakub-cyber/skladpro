// Воронка статусов заказа (опт/склад)
export const ORDER_STATUSES = [
  { key: 'new', label: 'Новый', color: 'info', step: 0 },
  { key: 'confirmed', label: 'Подтверждён', color: 'info', step: 1 },
  { key: 'picking', label: 'Сборка', color: 'warn', step: 2 },
  { key: 'packed', label: 'Собран', color: 'brand', step: 3 },
  { key: 'shipped', label: 'В пути', color: 'brand', step: 4 },
  { key: 'delivered', label: 'Доставлен', color: 'ok', step: 5 },
  { key: 'cancelled', label: 'Отменён', color: 'bad', step: -1 },
]

export const statusInfo = (key) =>
  ORDER_STATUSES.find((s) => s.key === key) || ORDER_STATUSES[0]

// Этапы, видимые клиенту в трекинге (без cancelled)
export const TRACK_FLOW = ORDER_STATUSES.filter((s) => s.step >= 0)

export const nextStatus = (key) => {
  const cur = statusInfo(key)
  if (cur.step < 0) return null
  return TRACK_FLOW.find((s) => s.step === cur.step + 1)?.key || null
}

// Категории товаров
export const CATEGORIES = [
  { key: 'Крепёж', color: '#f59e0b', icon: 'Wrench' },
  { key: 'Инструмент', color: '#7c6cff', icon: 'Hammer' },
  { key: 'Электрика', color: '#38bdf8', icon: 'Zap' },
  { key: 'Сантехника', color: '#10b981', icon: 'Droplets' },
  { key: 'ЛКМ', color: '#f43f5e', icon: 'PaintBucket' },
  { key: 'Расходники', color: '#94a3b8', icon: 'Package' },
]

export const catInfo = (key) =>
  CATEGORIES.find((c) => c.key === key) || CATEGORIES[5]

// Уровни лояльности по сумме покупок
export const TIERS = [
  { key: 'base', label: 'База', min: 0, discount: 0, color: '#94a3b8' },
  { key: 'silver', label: 'Серебро', min: 150000, discount: 3, color: '#cbd5e1' },
  { key: 'gold', label: 'Золото', min: 500000, discount: 5, color: '#fbbf24' },
  { key: 'platinum', label: 'Платина', min: 1500000, discount: 8, color: '#a78bfa' },
]

export const tierFor = (total) =>
  [...TIERS].reverse().find((t) => total >= t.min) || TIERS[0]

// Роли сотрудников и права доступа к разделам
export const ROLES = [
  { key: 'admin', label: 'Администратор', color: '#7c6cff', access: '*' },
  {
    key: 'manager',
    label: 'Менеджер',
    color: '#38bdf8',
    access: ['dashboard', 'orders', 'delivery', 'products', 'warehouse', 'invoices', 'operations', 'customers', 'suppliers', 'analytics', 'storefront', 'journal'],
  },
  {
    key: 'stock',
    label: 'Кладовщик',
    color: '#10b981',
    access: ['dashboard', 'orders', 'products', 'warehouse', 'invoices', 'operations'],
  },
  {
    key: 'courier',
    label: 'Курьер',
    color: '#f59e0b',
    access: ['dashboard', 'delivery', 'orders'],
  },
]

export const roleInfo = (key) => ROLES.find((r) => r.key === key) || ROLES[0]

export const canAccess = (roleKey, perm) => {
  const r = roleInfo(roleKey)
  return r.access === '*' || r.access.includes(perm)
}

// Категории (типы) цен. factor — только для генерации демо-цен.
export const PRICE_TYPE_SEED = [
  { id: 'pt_retail', name: 'Розница', factor: 1.0, default: true, color: '#7c6cff' },
  { id: 'pt_opt_delivery', name: 'Опт с доставкой', factor: 0.93, color: '#38bdf8' },
  { id: 'pt_opt_local', name: 'Опт на месте', factor: 0.88, color: '#10b981' },
  { id: 'pt_credit', name: 'В долг', factor: 1.06, color: '#f59e0b' },
  { id: 'pt_internal', name: 'На склад', factor: 0.82, color: '#94a3b8' },
]

// Цена товара по выбранной категории (с откатом на базовую)
export const priceFor = (product, priceTypeId) =>
  product?.prices?.[priceTypeId] ?? product?.price ?? 0

// Геометрия склада
export const GRID_W = 15
export const GRID_H = 9
export const ENTRANCE = { x: 1, y: 8, label: 'Выдача / Сборка' }
export const RECEIVING = { x: 1, y: 1, label: 'Приёмка' }
