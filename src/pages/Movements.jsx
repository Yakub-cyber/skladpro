// «Движение товара» — единая лента всех операций, влияющих на склад
// и деньги. Собирает 4 источника в один timeline:
//   documents (складские: purchase/sale/writeoff/inventory/…),
//   orders    (заказы клиентов — status=posted/delivered = движение),
//   invoices  (накладные приход/расход),
//   moneyTx   (кассовые движения: ПКО/РКО/переводы).
//
// Табличный вид по образцу CloudShop: колонки Статус / Документ /
// Время / Позиций / Сумма / Оплачено / Отправитель / Получатель /
// Автор, sticky-заголовки дней, узкая полоска фильтров сверху.
import { useMemo, useState } from 'react'
import {
  BarChart3,
  AlertTriangle,
  Search,
  Filter as FilterIcon,
} from 'lucide-react'
import { Card, Badge, Field, Input, Select, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { docTypeInfo, statusInfo } from '../lib/constants'
import { rangeFor, purposeLabel } from '../lib/money'

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
  { key: 'month', label: '30 дней' },
  { key: 'all', label: 'Всё время' },
]

const KIND_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'goods-in', label: 'Товар: приход' },
  { key: 'goods-out', label: 'Товар: расход' },
  { key: 'money-in', label: 'Деньги: приход' },
  { key: 'money-out', label: 'Деньги: расход' },
]

// Классификация типа документа для фильтра.
function classify(row) {
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
  if (row.kind === 'order') return 'goods-out' // заказ клиенту = будущий расход
  return 'other'
}

function TONE_FOR(kind) {
  if (kind.startsWith('goods-in') || kind === 'money-in') return 'ok'
  if (kind.startsWith('goods-out') || kind === 'money-out') return 'bad'
  return 'info'
}

// Собрать timeline из 4 источников. Дополняем полями `sum` (для складских
// документов из d.total), `paid` (для order из payment.cashPaid+cardPaid)
// и парой `from` / `to` — для колонок Отправитель / Получатель.
function buildTimeline(state) {
  const company = state.settings?.company || 'Склад'
  const rows = []

  // Резолвим имя склада (для transfer) или клиента/поставщика по id.
  const custName = (id) => (state.customers || []).find((c) => c.id === id)?.name
  const supName = (id) => (state.suppliers || []).find((s) => s.id === id)?.name
  const whName = (id) =>
    (state.warehouses || []).find((w) => w.id === id)?.name || 'Склад'
  const accName = (id) => (state.accounts || []).find((a) => a.id === id)?.name || '—'

  for (const d of state.documents || []) {
    if (d.status === 'cancelled') continue
    // От → к: логика зависит от типа документа.
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
        // sale_return — обратно (клиент → склад), но визуально пусть будет
        // клиент как контрагент.
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
      href: '#/operations',
      raw: d,
    })
  }

  for (const o of state.orders || []) {
    if (o.status === 'cancelled') continue
    const p = o.payment || {}
    const paid = (Number(p.cashPaid) || 0) + (Number(p.cardPaid) || 0)
    rows.push({
      kind: 'order',
      at: o.createdAt,
      no: o.no,
      title: `Продажа · ${statusInfo(o.status).label}`,
      by: o.by,
      qty: (o.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
      sum: o.total,
      paid: paid || (['delivered', 'shipped'].includes(o.status) ? o.total : 0),
      from: company,
      to: o.customerName || custName(o.customerId) || 'Розница',
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
      href: '#/invoices',
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
      paid: t.amount, // money-транзакция всегда «оплачено» полностью
      from,
      to,
      status: t.status || 'posted',
      href: '#/money',
      raw: t,
    })
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1))
  return rows
}

// Заголовок группы по дню — «25 июля», «Сегодня», «Вчера».
function dayLabel(iso) {
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
function statusDot(row) {
  const c = classify(row)
  if (row.status === 'draft') return { color: 'bg-warn', title: 'Черновик' }
  if (row.status === 'cancelled') return { color: 'bg-bad', title: 'Отменён' }
  if (c.startsWith('goods-in') || c === 'money-in')
    return { color: 'bg-ok', title: 'Приход' }
  if (c.startsWith('goods-out') || c === 'money-out')
    return { color: 'bg-bad', title: 'Расход' }
  return { color: 'bg-info', title: 'Служебное' }
}

export default function Movements() {
  const state = useStore()
  const employees = state.employees || []
  const customers = state.customers || []
  const suppliers = state.suppliers || []
  const accounts = state.accounts || []

  const [period, setPeriod] = useState('month')
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [empId, setEmpId] = useState('all')
  const [partyId, setPartyId] = useState('all')
  const [accId, setAccId] = useState('all')
  // CloudShop-стайл фильтры: docStatus (all/posted/draft/cancelled),
  // paymentStatus (all/paid/partial/unpaid), fromParty/toParty (отдельно
  // отправитель/получатель — вместо единого partyId). Панель «Фильтр»
  // прячет расширенные поля до клика — как в оригинале.
  const [docStatus, setDocStatus] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [fromParty, setFromParty] = useState('all')
  const [toParty, setToParty] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const timeline = useMemo(() => buildTimeline(state), [state])
  const range = useMemo(() => rangeFor(period), [period])

  const nameMatch = (name, id) => {
    if (id === 'all' || !name) return true
    const c = customers.find((x) => x.id === id)
    const s = suppliers.find((x) => x.id === id)
    const target = c?.name || s?.name
    return target && name.toLowerCase().includes(target.toLowerCase())
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return timeline.filter((r) => {
      if (range.from && r.at < range.from) return false
      if (range.to && r.at > range.to) return false
      const cls = classify(r)
      if (kind !== 'all' && cls !== kind) return false
      if (empId !== 'all' && r.by !== empId) return false
      if (partyId !== 'all') {
        // Проверка partyId по всем источникам (customer/supplier/party name).
        const raw = r.raw
        const has =
          raw.customerId === partyId ||
          raw.supplierId === partyId ||
          raw.partyId === partyId
        if (!has) return false
      }
      if (fromParty !== 'all' && !nameMatch(r.from, fromParty)) return false
      if (toParty !== 'all' && !nameMatch(r.to, toParty)) return false
      if (docStatus !== 'all' && r.status !== docStatus) return false
      if (paymentStatus !== 'all') {
        const paid = Number(r.paid) || 0
        const sum = Number(r.sum) || 0
        const st =
          sum === 0 ? 'paid' : paid >= sum ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
        if (st !== paymentStatus) return false
      }
      if (accId !== 'all') {
        if (r.kind !== 'money') return false
        if (r.raw.accountId !== accId && r.raw.toAccountId !== accId) return false
      }
      if (s) {
        const hay = `${r.no} ${r.title} ${r.from || ''} ${r.to || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [timeline, range, kind, empId, partyId, accId, q, docStatus, paymentStatus, fromParty, toParty])

  // Группировка по дням для sticky-заголовков.
  const groups = useMemo(() => {
    const g = []
    let cur = null
    for (const r of filtered.slice(0, 500)) {
      const label = dayLabel(r.at)
      if (!cur || cur.label !== label) {
        cur = { label, rows: [] }
        g.push(cur)
      }
      cur.rows.push(r)
    }
    return g
  }, [filtered])

  const nameOf = (id) => employees.find((e) => e.id === id)?.name || '—'
  const fmtTime = (iso) =>
    new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="animate-fadeUp space-y-4">
      {/* CloudShop-стайл фильтров: узкая верхняя полоска (5 полей) +
          справа кнопка «Фильтр», раскрывающая панель с расширенными
          параметрами (Автор, Отправитель, Получатель, Касса/счёт). */}
      <Card className="p-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
          <Field label="Поиск">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Номер или комментарий…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Дата">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Статус">
            <Select value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>
              <option value="all">Все</option>
              <option value="posted">Проведён</option>
              <option value="draft">Черновик</option>
              <option value="cancelled">Отменён</option>
            </Select>
          </Field>
          <Field label="Оплата">
            <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
              <option value="all">Все</option>
              <option value="paid">Оплачено</option>
              <option value="partial">Частично</option>
              <option value="unpaid">Не оплачено</option>
            </Select>
          </Field>
          <Field label="Тип">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_TABS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="&nbsp;">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cx(
                'h-10 px-4 rounded-xl border text-sm font-medium inline-flex items-center gap-2 transition',
                filtersOpen
                  ? 'bg-brand text-brand-ink border-brand'
                  : 'bg-surface-2 border-line hover:border-brand/40',
              )}
            >
              <FilterIcon size={15} />
              Фильтр
            </button>
          </Field>
        </div>
        {filtersOpen && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 pt-3 border-t border-line animate-fadeUp">
            <Field label="Автор">
              <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
                <option value="all">Все</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Отправитель">
              <Select value={fromParty} onChange={(e) => setFromParty(e.target.value)}>
                <option value="all">Все</option>
                <optgroup label="Клиенты">
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Поставщики">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="Получатель">
              <Select value={toParty} onChange={(e) => setToParty(e.target.value)}>
                <option value="all">Все</option>
                <optgroup label="Клиенты">
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Поставщики">
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="Касса / счёт">
              <Select value={accId} onChange={(e) => setAccId(e.target.value)}>
                <option value="all">Все</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {/* Таблица движений */}
      <Card className="overflow-hidden">
        {groups.length === 0 ? (
          <Empty
            icon={BarChart3}
            title="Ничего не найдено"
            text="Смените период или сбросьте фильтры."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2/60 text-muted text-[11.5px] uppercase tracking-wide">
                <tr>
                  <th className="w-8 pl-3 py-2"></th>
                  <th className="text-left py-2 pr-3">Документ</th>
                  <th className="text-left py-2 pr-3 w-16">Время</th>
                  <th className="text-right py-2 pr-3 w-16">Поз.</th>
                  <th className="text-right py-2 pr-3 w-28">Сумма</th>
                  <th className="text-right py-2 pr-3 w-28">Оплачено</th>
                  <th className="text-left py-2 pr-3">Отправитель</th>
                  <th className="text-left py-2 pr-3">Получатель</th>
                  <th className="text-left py-2 pr-3 w-32">Автор</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <FragmentGroup
                    key={g.label}
                    label={g.label}
                    rows={g.rows}
                    nameOf={nameOf}
                    fmtTime={fmtTime}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 500 && (
          <div className="px-4 py-2 text-[12px] text-muted border-t border-line">
            Показаны первые 500 из {filtered.length}. Сузьте фильтр, чтобы увидеть остальное.
          </div>
        )}
      </Card>
    </div>
  )
}

// Одна группа-день: строка-заголовок (sticky) + строки-документы.
function FragmentGroup({ label, rows, nameOf, fmtTime }) {
  return (
    <>
      <tr className="sticky top-0 z-10 bg-surface-3 text-ink">
        <td colSpan={9} className="px-3 py-1.5 text-[12px] font-semibold">
          {label} · {rows.length}
        </td>
      </tr>
      {rows.map((r, i) => {
        const dot = statusDot(r)
        const cancelled = r.status === 'cancelled'
        const draft = r.status === 'draft'
        return (
          <tr
            key={`${r.kind}-${r.no}-${i}`}
            className={cx(
              'border-t border-line hover:bg-surface-2/60 transition cursor-pointer',
              cancelled && 'opacity-50 line-through',
            )}
            onClick={() => (window.location.hash = r.href.replace(/^#/, ''))}
          >
            <td className="pl-3 py-2 align-middle">
              <span
                className={cx('inline-block w-2.5 h-2.5 rounded-full', dot.color)}
                title={dot.title}
              />
            </td>
            <td className="py-2 pr-3 align-middle">
              <div className="flex items-center gap-1.5">
                {draft && (
                  <AlertTriangle size={13} className="text-warn shrink-0" title="Черновик" />
                )}
                <span className="font-medium truncate">{r.title}</span>
                <Badge tone="brand" className="text-[10px] shrink-0">{r.no}</Badge>
              </div>
            </td>
            <td className="py-2 pr-3 align-middle tabular-nums text-muted">
              {fmtTime(r.at)}
            </td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums">
              {r.qty != null ? num(r.qty) : ''}
            </td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums font-medium">
              {r.sum != null ? money(r.sum) : ''}
            </td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums">
              {r.paid != null && r.paid > 0 ? (
                <span
                  className={cx(
                    r.sum && r.paid >= r.sum ? 'text-ok' : 'text-warn',
                  )}
                >
                  {money(r.paid)}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td className="py-2 pr-3 align-middle truncate max-w-[180px]">
              {r.from || '—'}
            </td>
            <td className="py-2 pr-3 align-middle truncate max-w-[180px]">
              {r.to || '—'}
            </td>
            <td className="py-2 pr-3 align-middle truncate max-w-[140px] text-muted">
              {r.by ? nameOf(r.by) : ''}
            </td>
          </tr>
        )
      })}
    </>
  )
}

