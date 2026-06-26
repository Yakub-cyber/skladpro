// ──────────────────────────────────────────────────────────────────────────
//  ИИ-движок СкладПро
//  Работает полностью локально и оффлайн. Точка расширения под облачный LLM
//  (DeepSeek/OpenRouter) — askLLM(): подставь ключ в настройках и включи.
// ──────────────────────────────────────────────────────────────────────────

// Единицы измерения и их синонимы → нормализованная форма
const UNIT_MAP = {
  шт: ['шт', 'штук', 'штуки', 'штука', 'pcs'],
  кг: ['кг', 'килограмм', 'килограмма', 'килограммов'],
  г: ['г', 'гр', 'грамм', 'грамма', 'граммов'],
  т: ['т', 'тонн', 'тонна', 'тонны'],
  л: ['л', 'литр', 'литра', 'литров'],
  мл: ['мл', 'миллилитр'],
  м: ['м', 'метр', 'метра', 'метров', 'пм', 'п.м'],
  см: ['см', 'сантиметр'],
  мм: ['мм', 'миллиметр'],
  уп: ['уп', 'упак', 'упаковка', 'упаковки', 'упак.'],
  кор: ['кор', 'короб', 'коробка', 'коробки', 'коробок'],
  пал: ['пал', 'паллет', 'паллета', 'паллеты', 'поддон'],
  рул: ['рул', 'рулон', 'рулона', 'рулонов'],
  пач: ['пач', 'пачка', 'пачки', 'пачек'],
  компл: ['компл', 'комплект', 'комплекта', 'к-т', 'набор'],
  пара: ['пара', 'пар', 'пары'],
  меш: ['меш', 'мешок', 'мешка', 'мешков'],
}

const UNIT_LOOKUP = Object.entries(UNIT_MAP).reduce((acc, [norm, list]) => {
  list.forEach((w) => (acc[w] = norm))
  return acc
}, {})

const UNIT_ALT = Object.keys(UNIT_LOOKUP)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace('.', '\\.'))
  .join('|')

// Нормализация строки для сопоставления: латиница↔кириллица «x», нижний регистр
const norm = (s = '') =>
  s
    .toLowerCase()
    .replace(/[×хx]/g, 'x')
    .replace(/ё/g, 'е')
    .replace(/[^\wа-я0-9.,x\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOP = new Set(['и', 'в', 'на', 'по', 'для', 'с', 'из', 'шт', 'the'])

const tokens = (s = '') =>
  norm(s)
    .split(/[\s,]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))

// Сопоставление позиции с каталогом по пересечению токенов + артикулу
export function matchProduct(name, products = []) {
  const q = tokens(name)
  if (!q.length) return null
  const nq = norm(name)
  let best = null
  let bestScore = 0
  for (const p of products) {
    const hay = norm(`${p.name} ${p.sku || ''} ${(p.tags || []).join(' ')}`)
    const pt = new Set(tokens(`${p.name} ${(p.tags || []).join(' ')}`))
    let hit = 0
    for (const t of q) if (pt.has(t) || hay.includes(t)) hit++
    let score = hit / q.length
    // прямое совпадение артикула — сильный сигнал
    if (p.sku && nq.includes(norm(p.sku))) score += 0.6
    // бонус за вхождение всего запроса
    if (hay.includes(nq)) score += 0.25
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return bestScore >= 0.6 ? { product: best, score: Math.min(1, bestScore) } : null
}

// Разбор одной строки позиции
function parseLine(raw, products) {
  let line = raw
    .replace(/^[\s\-–—•*·▪◦]+/, '') // маркеры списка
    .replace(/^\d+[).]\s*/, '') // «1) », «2. »
    .trim()
  if (!line) return null

  // Маскируем размеры (3.5x40, 10х15х2), чтобы не спутать с количеством
  const sizes = []
  let masked = line.replace(
    /\d+[.,]?\d*\s*[xх×]\s*\d+[.,]?\d*(?:\s*[xх×]\s*\d+[.,]?\d*)?/gi,
    (m) => {
      sizes.push(m)
      return `§${sizes.length - 1}§`
    },
  )

  let qty = null
  let unit = null
  let qtyFrag = null

  // a) число + единица (берём последнее вхождение)
  const reUnit = new RegExp(`(\\d+[.,]?\\d*)\\s*(${UNIT_ALT})\\.?(?=\\s|$)`, 'gi')
  let m, last
  while ((m = reUnit.exec(masked))) last = m
  if (last) {
    qty = parseFloat(last[1].replace(',', '.'))
    unit = UNIT_LOOKUP[last[2].toLowerCase().replace('.', '')] || 'шт'
    qtyFrag = last[0]
  }

  // b) число в конце строки
  if (qty == null) {
    const tail = masked.match(/(?:^|[\s\-–—:=x×])(\d+[.,]?\d*)\s*$/)
    if (tail) {
      qty = parseFloat(tail[1].replace(',', '.'))
      qtyFrag = tail[1]
    }
  }
  // c) число в начале строки
  if (qty == null) {
    const head = masked.match(/^(\d+[.,]?\d*)\s+(?=\D)/)
    if (head) {
      qty = parseFloat(head[1].replace(',', '.'))
      qtyFrag = head[1]
    }
  }

  // Возвращаем размеры на место и вычищаем название
  let name = masked
  if (qtyFrag) name = name.replace(qtyFrag, ' ')
  name = name
    .replace(/§(\d+)§/g, (_, i) => sizes[i])
    .replace(/\s*[xх×]\s*$/, '')
    .replace(/[\s\-–—:=]+$/, '')
    .replace(/^[\s\-–—:=]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!name) return null

  const match = matchProduct(name, products)
  const product = match?.product
  return {
    name: product?.name || capitalize(name),
    qty: qty == null ? 1 : qty,
    unit: unit || product?.unit || 'шт',
    sku: product?.sku || null,
    price: product?.price ?? null,
    productId: product?.id || null,
    matched: !!product,
    confidence: match ? Math.round(match.score * 100) : 0,
    raw: raw.trim(),
  }
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// Главная функция: текст → позиции накладной
export function parseInvoiceText(text, products = []) {
  if (!text?.trim()) return []
  // делим по строкам, затем по «;» и «,» (если в части есть цифра — вероятно отдельная позиция)
  const chunks = text
    .split(/\r?\n/)
    .flatMap((l) =>
      l
        .split(/[;]+/)
        .flatMap((p) => (/[,].*\d/.test(p) ? p.split(/,(?=[^,]*\d)/) : [p])),
    )
  const items = []
  for (const c of chunks) {
    const it = parseLine(c, products)
    if (it) items.push(it)
  }
  // объединяем дубликаты по названию
  const merged = []
  for (const it of items) {
    const ex = merged.find(
      (x) => norm(x.name) === norm(it.name) && x.unit === it.unit,
    )
    if (ex) ex.qty += it.qty
    else merged.push(it)
  }
  return merged
}

// ── Маршрут сборщика (оптимизация обхода) ──────────────────────────────────
// Жадный nearest-neighbour от точки входа склада. Манхэттенская метрика по сетке.
const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

export function buildPickRoute(points, start = { x: 0, y: 0 }) {
  const pts = points.filter((p) => p && typeof p.x === 'number')
  if (!pts.length) return { order: [], distance: 0 }
  const remaining = [...pts]
  const order = []
  let cur = start
  let total = 0
  while (remaining.length) {
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = dist(cur, remaining[i])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    total += bd
    cur = remaining[bi]
    order.push(remaining[bi])
    remaining.splice(bi, 1)
  }
  total += dist(cur, start) // возврат к зоне выдачи
  return { order, distance: total }
}

// ── Аналитические инсайты (локальная «ИИ-аналитика») ───────────────────────
export function analyticsInsights({ products = [], orders = [] }) {
  const out = []

  // 1. Низкие остатки → совет закупить
  const low = products
    .filter((p) => p.stock <= p.minStock)
    .sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock))
  if (low.length) {
    out.push({
      id: 'low',
      severity: 'bad',
      icon: 'PackageMinus',
      title: `${low.length} ${plural(low.length, 'позиция', 'позиции', 'позиций')} ниже минимума`,
      text: `Пора пополнить: ${low.slice(0, 3).map((p) => p.name).join(', ')}${low.length > 3 ? ' и др.' : ''}. Рекомендую сформировать заявку поставщику.`,
      action: { to: '/suppliers', label: 'Создать закупку' },
    })
  }

  // 2. Прогноз исчерпания по скорости продаж
  const sold = soldByProduct(orders)
  const risk = products
    .map((p) => {
      const perDay = (sold[p.id] || 0) / 30 // продажи за ~месяц истории
      const days = perDay > 0 ? Math.round(p.stock / perDay) : Infinity
      return { p, perDay, days }
    })
    .filter((r) => r.perDay > 0 && r.days <= 10)
    .sort((a, b) => a.days - b.days)
  if (risk.length) {
    const r = risk[0]
    out.push({
      id: 'forecast',
      severity: 'warn',
      icon: 'TrendingDown',
      title: `«${r.p.name}» закончится за ~${r.days} дн.`,
      text: `Расход ${r.perDay.toFixed(1)} ${r.p.unit}/день, на складе ${r.p.stock}. Ещё ${risk.length - 1 > 0 ? `${risk.length - 1} позиций в зоне риска.` : 'это самая срочная позиция.'}`,
      action: { to: '/analytics', label: 'Открыть прогноз' },
    })
  }

  // 3. Топ-товар
  const topId = Object.entries(sold).sort((a, b) => b[1] - a[1])[0]?.[0]
  const top = products.find((p) => p.id === topId)
  if (top) {
    out.push({
      id: 'top',
      severity: 'ok',
      icon: 'Flame',
      title: `Хит продаж: ${top.name}`,
      text: `Продано ${sold[topId]} ${top.unit} за месяц. Держите запас выше среднего и предложите оптовым клиентам.`,
    })
  }

  // 4. Неликвид
  const dead = products.filter((p) => !sold[p.id] && p.stock > 0)
  if (dead.length >= 3) {
    out.push({
      id: 'dead',
      severity: 'info',
      icon: 'Snowflake',
      title: `${dead.length} ${plural(dead.length, 'позиция', 'позиции', 'позиций')} без движения`,
      text: `Залежался товар на ${money(sum(dead.map((p) => p.stock * p.cost)))}. Стоит сделать акцию или вернуть поставщику.`,
    })
  }

  return out
}

export function soldByProduct(orders = []) {
  const map = {}
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    for (const it of o.items || []) {
      map[it.productId] = (map[it.productId] || 0) + it.qty
    }
  }
  return map
}

// мелкие локальные хелперы (дубликаты, чтобы ai.js не зависел от format/id)
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
function money(v) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽'
}
function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0)
}

// ── Точка расширения под облачный LLM ──────────────────────────────────────
// Когда добавишь ключ DeepSeek/OpenRouter в Настройках — этот вызов можно
// включить для разбора «грязного» текста и генерации текстовых отчётов.
// baseUrl по умолчанию — ProxyAPI (через него ходит DeepSeek из РФ).
// Прямой api.deepseek.com из РФ часто недоступен/отдаёт 401.
export async function askLLM(
  prompt,
  { apiKey, model = 'deepseek-chat', baseUrl } = {},
) {
  if (!apiKey) throw new Error('Нет API-ключа: работаем локально')
  const base = (baseUrl || 'https://api.proxyapi.ru/deepseek').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 80)}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// Разбор накладной через облачный LLM (DeepSeek). Фолбэк — локальный парсер.
export async function aiParseInvoice(text, products = [], { apiKey, model, baseUrl } = {}) {
  if (!apiKey) return parseInvoiceText(text, products)
  const prompt =
    'Ты помощник склада. Разбери текст накладной в JSON-массив позиций. ' +
    'Каждый элемент: {"name": строка, "qty": число, "unit": строка (шт/кг/уп/м/л и т.п.)}. ' +
    'Размеры (3.5x40) — часть названия, НЕ количество. Верни ТОЛЬКО JSON-массив, без пояснений.\n\nТекст:\n' +
    text
  const raw = await askLLM(prompt, { apiKey, model, baseUrl })
  const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
  let arr
  try {
    arr = JSON.parse(json)
  } catch {
    return parseInvoiceText(text, products) // не распарсилось — локальный фолбэк
  }
  return arr
    .filter((x) => x && x.name)
    .map((x) => {
      const match = matchProduct(x.name, products)
      const product = match?.product
      return {
        name: product?.name || x.name,
        qty: Number(x.qty) || 1,
        unit: product?.unit || x.unit || 'шт',
        sku: product?.sku || null,
        price: product?.price ?? null,
        productId: product?.id || null,
        matched: !!product,
        confidence: match ? Math.round(match.score * 100) : 0,
        raw: x.name,
      }
    })
}
