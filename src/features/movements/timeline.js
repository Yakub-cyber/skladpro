// Логика построения timeline для «Движения товара»: 4 источника
// (documents/orders/invoices/moneyTx) сводим в единый список строк.
// UI-независимо — можно тестировать отдельно.
import { docTypeInfo, statusInfo } from '@/shared/lib/constants'
import { purposeLabel } from '@/shared/lib/money'

// Классификация типа документа для фильтра.
export function classify(row) {
  // row.kind: 'doc' | 'order' | 'invoice' | 'money'
  if (row.kind === 'money') {
    if (row.raw.type === 'in') return 'money-in'
    if (row.raw.type === 'out') return 'money-out'
    return 'money-transfer'
  }
  const t = row.raw.type || (row.kind === 'invoice' ? row.raw.kind : null)
  if (['purchase', 'stockin', 'sale_return', 'in'].includes(t)) return 'goods-in'
  if (['sale', 'writeoff', 'supplier_return', 'out'].includes(t)) return 'goods-out'
  if (t === 'transfer') return 'goods-transfer'
  if (t === 'inventory') return 'goods-inv'
  // F1-4: refund-order — товар возвращается покупателем НА склад → goods-in.
  if (row.kind === 'order' && row.raw.kind === 'refund') return 'goods-in'
  if (row.kind === 'order') return 'goods-out' // заказ клиенту = будущий расход
  return 'other'
}

// Собрать timeline из 4 источников. Дополняем `sum`, `paid` и парой
// `from` / `to` — для колонок Отправитель / Получатель.
export function buildTimeline(state) {
  const company = state.settings?.company || 'Склад'
  const rows = []

  const custName = (id) => (state.customers || []).find((c) => c.id === id)?.name
  const supName = (id) => (state.suppliers || []).find((s) => s.id === id)?.name
  const whName = (id) =>
    (state.warehouses || []).find((w) => w.id === id)?.name || 'Склад'
  const accName = (id) => (state.accounts || []).find((a) => a.id === id)?.name || '—'

  for (const d of state.documents || []) {
    if (d.status === 'cancelled' || d.status === 'void') continue
    let from = null
    let to = null
    switch (d.type) {
      case 'purchase':
      case 'stockin':
        from = supName(d.supplierId) || 'Внешний'
        to = company
        break
      case 'sale':
      case 'sale_return':
        from = d.type === 'sale_return' ? custName(d.customerId) || d.customerName : company
        to = d.type === 'sale_return' ? company : custName(d.customerId) || d.customerName
        break
      case 'supplier_return':
        from = company
        to = supName(d.supplierId) || 'Поставщик'
        break
      case 'transfer':
        from = whName(d.fromWarehouseId)
        to = whName(d.toWarehouseId)
        break
      case 'writeoff':
      case 'inventory':
      default:
        from = company
        to = null
    }
    rows.push({
      kind: 'doc',
      at: d.postedAt || d.createdAt,
      no: d.no,
      title: docTypeInfo(d.type).label,
      type: d.type,
      by: d.by,
      qty: d.totalQty,
      sum: Number(d.total) || null,
      paid: null,
      from,
      to,
      status: d.status,
      // F1-13: href содержит id/no, чтобы клик по строке вёл в конкретный документ.
      href: `#/operations?docId=${d.id}`,
      raw: d,
    })
  }

  for (const o of state.orders || []) {
    if (o.status === 'cancelled') continue
    const p = o.payment || {}
    const paid = (Number(p.cashPaid) || 0) + (Number(p.cardPaid) || 0)
    const isRefund = o.kind === 'refund'
    rows.push({
      kind: 'order',
      at: o.createdAt,
      no: o.no,
      // F1-4: refund-order — свой заголовок; from/to меняются местами.
      title: isRefund ? `Возврат по чеку` : `Продажа · ${statusInfo(o.status).label}`,
      by: o.by,
      qty: (o.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
      sum: o.total,
      paid: paid || (['delivered', 'shipped'].includes(o.status) ? o.total : 0),
      from: isRefund ? o.customerName || custName(o.customerId) || 'Клиент' : company,
      to: isRefund ? company : o.customerName || custName(o.customerId) || 'Розница',
      status: o.status,
      href: `#/orders?id=${o.id}`,
      raw: o,
    })
  }

  for (const inv of state.invoices || []) {
    rows.push({
      kind: 'invoice',
      at: inv.createdAt,
      no: inv.no,
      title: inv.kind === 'in' ? 'Приходная накладная' : 'Расходная накладная',
      by: null,
      qty: (inv.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
      sum: inv.total,
      paid: null,
      from: inv.kind === 'in' ? inv.party : company,
      to: inv.kind === 'in' ? company : inv.party,
      status: 'posted',
      href: `#/invoices?id=${inv.id}`,
      raw: inv,
    })
  }

  for (const t of state.moneyTx || []) {
    if (t.status === 'cancelled') continue
    let from = null
    let to = null
    if (t.type === 'in') {
      from = custName(t.customerId) || supName(t.supplierId) || 'Плательщик'
      to = accName(t.accountId)
    } else if (t.type === 'out') {
      from = accName(t.accountId)
      to = supName(t.supplierId) || custName(t.customerId) || 'Получатель'
    } else {
      from = accName(t.accountId)
      to = accName(t.toAccountId)
    }
    rows.push({
      kind: 'money',
      at: t.at,
      no: t.no,
      title: purposeLabel(t.type, t.purpose),
      by: t.by,
      qty: null,
      sum: t.amount,
      paid: t.amount,
      from,
      to,
      status: t.status || 'posted',
      href: `#/money?txId=${t.id}`,
      raw: t,
    })
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1))
  return rows
}

// Заголовок группы по дню — «25 июля», «Сегодня», «Вчера».
export function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Сегодня'
  if (sameDay(d, yest)) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Тональность точки-статуса.
export function statusDot(row) {
  const c = classify(row)
  if (row.status === 'draft') return { color: 'bg-warn', title: 'Черновик' }
  if (row.status === 'cancelled') return { color: 'bg-bad', title: 'Отменён' }
  if (row.status === 'void') return { color: 'bg-bad', title: 'Аннулирован' }
  if (c.startsWith('goods-in') || c === 'money-in')
    return { color: 'bg-ok', title: 'Приход' }
  if (c.startsWith('goods-out') || c === 'money-out')
    return { color: 'bg-bad', title: 'Расход' }
  return { color: 'bg-info', title: 'Служебное' }
}
