// Демо-данные оптового строительно-хозяйственного склада.
// Создаются один раз и сохраняются в localStorage (можно сбросить в Настройках).

import { GRID_W, PRICE_TYPE_SEED } from '../lib/constants'

// Детерминированный PRNG, чтобы демо было стабильным
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Ячейки склада (стеллажи на карте) ──────────────────────────────────────
const COL_X = { A: 3, B: 4, C: 6, D: 7, E: 9, F: 10, G: 12, H: 13 }
export const CELLS = []
for (const z of Object.keys(COL_X)) {
  for (let r = 1; r <= 5; r++) {
    CELLS.push({
      id: `${z}${r}`,
      code: `${z}${r}`,
      zone: z,
      x: COL_X[z],
      y: r + 1,
      warehouseId: 'wh1',
    })
  }
}
// демо-ячейки второго склада (магазин) — небольшая сетка
const CELLS_WH2 = []
for (const z of ['A', 'B', 'C']) {
  for (let r = 1; r <= 3; r++) {
    CELLS_WH2.push({
      id: `wh2-${z}${r}`,
      code: `${z}${r}`,
      zone: z,
      x: 3 + ['A', 'B', 'C'].indexOf(z) * 3,
      y: r + 1,
      warehouseId: 'wh2',
    })
  }
}
export const ALL_CELLS = [...CELLS, ...CELLS_WH2]

export const WAREHOUSES = [
  { id: 'wh1', name: 'Основной склад', address: 'Казань, Промзона 4' },
  { id: 'wh2', name: 'Магазин на Гвардейской', address: 'Казань, Гвардейская 14' },
]

// поиск ячейки по id или коду (в пределах склада, если задан)
export const cellById = (id, warehouseId) =>
  ALL_CELLS.find(
    (c) => (c.id === id || c.code === id) && (!warehouseId || c.warehouseId === warehouseId),
  )

// ── Товары ─────────────────────────────────────────────────────────────────
// [sku, name, category, unit, price, cost, stock, minStock, cell, tags]
const P = [
  ['КР-0070', 'Гвозди строительные 3×70', 'Крепёж', 'кг', 95, 62, 120, 40, 'A1', 'гвозди'],
  ['КР-0100', 'Гвозди 4×100', 'Крепёж', 'кг', 110, 72, 18, 40, 'A2', 'гвозди'],
  ['КР-3540', 'Саморез по дереву 3.5×40', 'Крепёж', 'уп', 180, 120, 260, 80, 'A3', 'саморез'],
  ['КР-4216', 'Саморез по металлу 4.2×16', 'Крепёж', 'уп', 150, 96, 24, 60, 'A4', 'саморез'],
  ['КР-6040', 'Дюбель-гвоздь 6×40', 'Крепёж', 'уп', 140, 88, 300, 90, 'A5', 'дюбель'],
  ['КР-АН10', 'Анкер клиновой 10×100', 'Крепёж', 'шт', 38, 22, 540, 150, 'B1', 'анкер'],
  ['КР-Б840', 'Болт М8×40 оцинк.', 'Крепёж', 'кг', 210, 140, 75, 30, 'B2', 'болт'],
  ['КР-Г8', 'Гайка М8 DIN934', 'Крепёж', 'кг', 195, 130, 90, 30, 'B3', 'гайка'],
  ['КР-Ш8', 'Шайба М8', 'Крепёж', 'кг', 180, 120, 110, 30, 'B4', 'шайба'],
  ['ИН-М500', 'Молоток слесарный 500г', 'Инструмент', 'шт', 540, 360, 42, 15, 'C1', 'молоток'],
  ['ИН-Ш18', 'Шуруповёрт аккум. 18В', 'Инструмент', 'шт', 4200, 3100, 12, 6, 'C2', 'шуруповёрт дрель'],
  ['ИН-Д750', 'Дрель ударная 750Вт', 'Инструмент', 'шт', 3800, 2700, 9, 4, 'C3', 'дрель'],
  ['ИН-Н450', 'Ножовка по дереву 450мм', 'Инструмент', 'шт', 620, 410, 30, 10, 'C4', 'ножовка пила'],
  ['ИН-Р5', 'Рулетка 5м', 'Инструмент', 'шт', 280, 175, 85, 25, 'C5', 'рулетка'],
  ['ИН-У600', 'Уровень 600мм', 'Инструмент', 'шт', 690, 460, 20, 8, 'D1', 'уровень'],
  ['ИН-Б32', 'Набор бит 32шт', 'Инструмент', 'компл', 450, 290, 38, 12, 'D2', 'биты набор'],
  ['ИН-Д125', 'Диск отрезной 125мм', 'Инструмент', 'уп', 320, 205, 16, 20, 'D3', 'диск круг'],
  ['ЭЛ-К325', 'Кабель ВВГ 3×2.5', 'Электрика', 'м', 78, 52, 1200, 300, 'E1', 'кабель провод'],
  ['ЭЛ-А16', 'Автомат C16 1P', 'Электрика', 'шт', 240, 160, 140, 50, 'E2', 'автомат'],
  ['ЭЛ-Р01', 'Розетка с з/к', 'Электрика', 'шт', 190, 120, 95, 40, 'E3', 'розетка'],
  ['ЭЛ-В01', 'Выключатель 1кл.', 'Электрика', 'шт', 160, 100, 110, 40, 'E4', 'выключатель'],
  ['ЭЛ-Г20', 'Гофра ПВХ 20мм', 'Электрика', 'м', 22, 13, 800, 200, 'E5', 'гофра'],
  ['СН-Т25', 'Труба ППР 25мм', 'Сантехника', 'м', 95, 62, 480, 150, 'F1', 'труба'],
  ['СН-К12', 'Кран шаровый 1/2"', 'Сантехника', 'шт', 320, 210, 70, 25, 'F2', 'кран'],
  ['СН-Ф25', 'Фитинг муфта 25мм', 'Сантехника', 'шт', 45, 28, 60, 80, 'F3', 'фитинг муфта'],
  ['ЛК-Г10', 'Грунтовка глубокая 10л', 'ЛКМ', 'шт', 720, 480, 34, 12, 'G1', 'грунтовка'],
  ['ЛК-К14', 'Краска ВД белая 14кг', 'ЛКМ', 'шт', 1450, 980, 22, 8, 'G2', 'краска'],
  ['РС-П01', 'Перчатки ХБ', 'Расходники', 'пара', 18, 9, 1500, 400, 'H1', 'перчатки'],
  ['РС-П750', 'Пена монтажная 750мл', 'Расходники', 'шт', 290, 185, 16, 30, 'H2', 'пена'],
  ['РС-С48', 'Скотч малярный 48мм', 'Расходники', 'шт', 85, 52, 240, 60, 'H3', 'скотч'],
]

const PRODUCTS = P.map((r, i) => ({
  id: `p${i + 1}`,
  sku: r[0],
  name: r[1],
  category: r[2],
  unit: r[3],
  price: r[4],
  cost: r[5],
  stock: r[6],
  minStock: r[7],
  cell: r[8],
  tags: r[9].split(' '),
  barcode: '46' + String(600000 + i * 137).padStart(11, '0'),
}))

// ── Клиенты ──────────────────────────────────────────────────────────────
// [name, type, city, contact, phone, totalSpent, bonus, daysAgo]
const C = [
  ['ООО «СтройДвор»', 'ООО', 'Казань', 'Ринат Хабиров', '+7 917 200-11-22', 1840000, 12400, 420],
  ['ИП Сергеев А.В.', 'ИП', 'Москва', 'Андрей Сергеев', '+7 916 555-40-30', 620000, 5200, 300],
  ['Бригада «РемонтМастер»', 'Бригада', 'Казань', 'Ильдар', '+7 927 333-12-90', 210000, 1800, 180],
  ['ООО «ГорСнаб»', 'ООО', 'Самара', 'ОльгаП.', '+7 846 210-55-00', 540000, 4100, 260],
  ['ИП Валиев Р.Р.', 'ИП', 'Казань', 'Руслан Валиев', '+7 919 690-00-71', 175000, 1500, 140],
  ['ТД «Хозяин»', 'ООО', 'Уфа', 'Марат С.', '+7 347 299-08-08', 980000, 7300, 350],
  ['Бригада Ахмета', 'Бригада', 'Казань', 'Ахмет', '+7 937 808-44-55', 96000, 700, 90],
  ['ООО «МегаСтрой»', 'ООО', 'Н.Новгород', 'Елена К.', '+7 831 400-90-10', 2240000, 19800, 500],
]

// ── Поставщики ─────────────────────────────────────────────────────────────
const S = [
  ['МетизТорг', 'Крепёж', '+7 843 200-10-10', 'Казань'],
  ['ИнструментПро', 'Инструмент', '+7 495 700-20-20', 'Москва'],
  ['ЭлектроБаза', 'Электрика', '+7 846 330-30-30', 'Самара'],
  ['АкваПласт', 'Сантехника', '+7 843 410-40-40', 'Казань'],
  ['ХимСнаб', 'ЛКМ / Расходники', '+7 347 500-50-50', 'Уфа'],
]

// Весовые товары (продаются на вес, кг) и их PLU-коды для весовых штрихкодов
const WEIGHTED = { 'КР-0070': 21, 'КР-Б840': 22, 'КР-Г8': 23, 'КР-Ш8': 24 }
// Маркируемые «Честным знаком» товары
const MARKED = new Set(['РС-П750', 'ЛК-К14'])

const genMarkCode = (sku, i) =>
  `0104${String(600000 + i).padStart(8, '0')}21${sku.replace(/\W/g, '')}${String(1000 + i)}`

export function makeSeed() {
  const now = Date.now()
  const day = 86400000
  const iso = (d) => new Date(d).toISOString()

  const products = PRODUCTS.map((p) => {
    const weighted = p.sku in WEIGHTED
    const marked = MARKED.has(p.sku)
    // цены по категориям (демо: базовая × коэффициент типа)
    const prices = {}
    for (const t of PRICE_TYPE_SEED) prices[t.id] = Math.round(p.price * t.factor)
    return {
      ...p,
      prices,
      warehouseId: 'wh1',
      weighted,
      plu: weighted ? WEIGHTED[p.sku] : undefined,
      marked,
      codes: marked
        ? Array.from({ length: Math.min(p.stock, 50) }, (_, i) => genMarkCode(p.sku, i))
        : [],
    }
  })

  const ptByType = {
    ООО: 'pt_opt_delivery',
    ИП: 'pt_opt_local',
    Бригада: 'pt_credit',
  }
  const customers = C.map((r, i) => ({
    id: `c${i + 1}`,
    name: r[0],
    type: r[1],
    city: r[2],
    contact: r[3],
    phone: r[4],
    email: `client${i + 1}@mail.ru`,
    totalSpent: r[5],
    bonus: r[6],
    since: iso(now - r[7] * day),
    priceTypeId: ptByType[r[1]] || 'pt_retail',
    // долг контрагента (положительный = должен нам)
    balance: r[1] === 'Бригада' ? 8000 + i * 2200 : i % 3 === 0 ? 14500 : 0,
  }))

  const suppliers = S.map((r, i) => ({
    id: `s${i + 1}`,
    name: r[0],
    category: r[1],
    phone: r[2],
    city: r[3],
  }))

  // Генерация заказов за 30 дней
  const rnd = mulberry32(20260620)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const couriers = ['Газель А231', 'Газель В784', 'Самовывоз', 'СДЭК']
  const streets = ['ул. Декабристов, 81', 'пр. Победы, 100', 'ул. Гвардейская, 14', 'ш. Энтузиастов, 5', 'ул. Зорге, 47']
  const statuses = ['delivered', 'delivered', 'delivered', 'shipped', 'packed', 'picking', 'confirmed', 'new', 'delivered', 'shipped', 'picking', 'new', 'delivered', 'cancelled']

  const orders = statuses.map((status, i) => {
    const cust = pick(customers)
    const nItems = 1 + Math.floor(rnd() * 4)
    const used = new Set()
    const items = []
    for (let k = 0; k < nItems; k++) {
      const p = pick(products)
      if (used.has(p.id)) continue
      used.add(p.id)
      const qty = 1 + Math.floor(rnd() * Math.min(20, Math.max(2, p.stock / 8)))
      items.push({ productId: p.id, name: p.name, qty, price: p.price, unit: p.unit, cell: p.cell })
    }
    const total = items.reduce((a, b) => a + b.qty * b.price, 0)
    const ageDays = Math.floor(rnd() * 28)
    const createdAt = now - ageDays * day - Math.floor(rnd() * day)

    // История трекинга по достигнутому статусу
    const flow = ['new', 'confirmed', 'picking', 'packed', 'shipped', 'delivered']
    const reached = status === 'cancelled' ? 1 : flow.indexOf(status) + 1
    const track = []
    for (let s = 0; s < reached; s++) {
      track.push({ status: flow[s], at: iso(createdAt + s * (day / 2)) })
    }
    if (status === 'cancelled') track.push({ status: 'cancelled', at: iso(createdAt + day / 2), note: 'Клиент отменил' })

    const courier = pick(couriers)
    return {
      id: `o${i + 1}`,
      no: `ЗК-2026-${String(101 + i).padStart(4, '0')}`,
      customerId: cust.id,
      customerName: cust.name,
      items,
      total,
      status,
      priority: rnd() > 0.8,
      courier,
      // часть доставок назначена демо-курьеру (Олег Курьеров) — для роли «курьер»
      assignedTo: courier !== 'Самовывоз' && i % 2 === 0 ? 'e4' : null,
      address: `${cust.city}, ${pick(streets)}`,
      createdAt: iso(createdAt),
      track,
    }
  })

  // Историческая выручка за год (для графиков «квартал» / «год»)
  for (let k = 0; k < 60; k++) {
    const cust = pick(customers)
    const nItems = 1 + Math.floor(rnd() * 3)
    const items = []
    const used = new Set()
    for (let j = 0; j < nItems; j++) {
      const p = pick(products)
      if (used.has(p.id)) continue
      used.add(p.id)
      const qty = 1 + Math.floor(rnd() * 12)
      items.push({ productId: p.id, name: p.name, qty, price: p.price, unit: p.unit, cell: p.cell })
    }
    const total = items.reduce((a, b) => a + b.qty * b.price, 0)
    const ageDays = 30 + Math.floor(rnd() * 340) // 30..370 дней назад
    const createdAt = now - ageDays * day
    orders.push({
      id: `oh${k + 1}`,
      no: `ЗК-арх-${String(k + 1).padStart(4, '0')}`,
      customerId: cust.id,
      customerName: cust.name,
      items,
      total,
      status: 'delivered',
      priority: false,
      courier: 'Самовывоз',
      address: cust.city,
      createdAt: iso(createdAt),
      track: [{ status: 'delivered', at: iso(createdAt) }],
    })
  }

  const employees = [
    { id: 'e1', name: 'Аюб Гадиев', role: 'admin', phone: '+7 900 000-00-01', pin: '1111', active: true },
    { id: 'e2', name: 'Марат Хайруллин', role: 'manager', phone: '+7 900 000-00-02', pin: '2222', active: true },
    { id: 'e3', name: 'Денис Кладов', role: 'stock', phone: '+7 900 000-00-03', pin: '3333', active: true },
    { id: 'e4', name: 'Олег Курьеров', role: 'courier', phone: '+7 900 000-00-04', pin: '4444', active: true },
  ]

  // Демо: одна закрытая смена (вчера)
  const shifts = [
    {
      id: 'sh_demo1',
      userId: 'e2',
      openedAt: iso(now - day - 8 * 3600000),
      closedAt: iso(now - day),
      openingCash: 5000,
      closingCash: 42300,
      revenue: 37300,
      ordersCount: 5,
      movesCount: 8,
    },
  ]

  return {
    products,
    customers,
    suppliers,
    orders,
    employees,
    movements: [],
    audit: [],
    shifts,
    activeShiftId: null,
    priceTypes: PRICE_TYPE_SEED.map(({ factor, ...t }) => t),
    invoices: [],
    documents: [],
    cells: ALL_CELLS.map((c) => ({ ...c })),
    warehouses: WAREHOUSES.map((w) => ({ ...w })),
    activeWarehouseId: 'wh1',
    settings: {
      company: 'СкладПро',
      currency: '₽',
      aiKey: '',
      aiModel: 'deepseek-chat',
      aiBaseUrl: 'https://api.proxyapi.ru/deepseek',
    },
  }
}
