// ──────────────────────────────────────────────────────────────────────────
//  ИИ-ассистент: сборка компактного контекста из данных склада для LLM.
//  Не отправляем всё подряд — только сводку и ключевые списки (с лимитами),
//  чтобы уложиться в разумное число токенов и не раскрывать лишнего.
// ──────────────────────────────────────────────────────────────────────────
import { soldByProduct } from './ai'

const n0 = (v) => Math.round(Number(v) || 0)

// state: { products, orders, customers }, opts.currency — валюта для подписи.
export function buildAssistantContext(state, { currency = '₽', maxProducts = 80 } = {}) {
  const products = state.products || []
  const orders = state.orders || []
  const customers = state.customers || []

  const sold = soldByProduct(orders)
  const active = orders.filter((o) => o.status !== 'cancelled')
  const revenue = active.reduce((a, o) => a + (o.total || 0), 0)
  const stockValue = products.reduce((a, p) => a + (p.stock || 0) * (p.cost || 0), 0)

  const lines = []
  lines.push(`Валюта: ${currency}.`)
  lines.push(
    `Итого: товаров ${products.length}, склад на ${n0(stockValue)} (в закупке), ` +
      `заказов ${orders.length}, выручка ${n0(revenue)}.`,
  )

  // Остатки ниже минимума
  const low = products
    .filter((p) => (p.stock || 0) <= (p.minStock || 0))
    .sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock))
  if (low.length) {
    lines.push('')
    lines.push(`НИЖЕ МИНИМУМА (${low.length}):`)
    low.slice(0, 20).forEach((p) =>
      lines.push(`- ${p.name}: ${p.stock} ${p.unit || 'шт'} (мин ${p.minStock || 0})`),
    )
  }

  // Топ продаж
  const top = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (top.length) {
    lines.push('')
    lines.push('ТОП ПРОДАЖ:')
    top.forEach(([id, qty]) => {
      const p = products.find((x) => x.id === id)
      if (p) lines.push(`- ${p.name}: продано ${qty} ${p.unit || 'шт'}`)
    })
  }

  // Неликвид
  const dead = products.filter((p) => !sold[p.id] && (p.stock || 0) > 0)
  if (dead.length) {
    lines.push('')
    lines.push(`БЕЗ ПРОДАЖ (неликвид, ${dead.length}):`)
    dead.slice(0, 8).forEach((p) => lines.push(`- ${p.name}: ${p.stock} ${p.unit || 'шт'}`))
  }

  // Должники
  const debtors = customers.filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance)
  if (debtors.length) {
    lines.push('')
    lines.push(`ДОЛЖНИКИ (${debtors.length}):`)
    debtors.slice(0, 15).forEach((c) => lines.push(`- ${c.name}: долг ${n0(c.balance)}`))
  }

  // Последние заказы
  if (orders.length) {
    lines.push('')
    lines.push('ПОСЛЕДНИЕ ЗАКАЗЫ:')
    orders.slice(0, 10).forEach((o) =>
      lines.push(`- ${o.no}: ${o.customerName || '—'}, ${n0(o.total)}, статус ${o.status}`),
    )
  }

  // Каталог (с лимитом)
  lines.push('')
  lines.push(`КАТАЛОГ (${Math.min(products.length, maxProducts)} из ${products.length}):`)
  products.slice(0, maxProducts).forEach((p) =>
    lines.push(
      `- ${p.name} [${p.sku || 'без арт.'}]: остаток ${p.stock} ${p.unit || 'шт'}, ` +
        `себест. ${n0(p.cost)}, цена ${n0(p.price ?? 0)}` +
        (p.cell ? `, ячейка ${p.cell}` : '') +
        (p.category ? `, ${p.category}` : ''),
    ),
  )
  if (products.length > maxProducts) {
    lines.push(`…и ещё ${products.length - maxProducts} товаров (не показаны).`)
  }

  return lines.join('\n')
}

// Собрать промпт для LLM: инструкция + контекст + вопрос.
export function buildAssistantPrompt(context, question) {
  return (
    'Ты — ассистент складского и оптового учёта в системе СкладПро. ' +
    'Отвечай кратко и по делу, по-русски, опираясь ТОЛЬКО на данные ниже. ' +
    'Если данных не хватает — так и скажи, не выдумывай числа. ' +
    'Суммы указывай с валютой. Для списков используй маркированный список.\n\n' +
    '=== ДАННЫЕ СКЛАДА ===\n' +
    context +
    '\n\n=== ВОПРОС ===\n' +
    question
  )
}
