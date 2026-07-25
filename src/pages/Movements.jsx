// «Движение товара» — единая лента всех операций, влияющих на склад
// и деньги. Собирает 4 источника в один timeline:
//   documents (складские: purchase/sale/writeoff/inventory/…),
//   orders    (заказы клиентов — status=posted/delivered = движение),
//   invoices  (накладные приход/расход),
//   moneyTx   (кассовые движения: ПКО/РКО/переводы).
// Фильтры: тип, период, контрагент, сотрудник, счёт.
//
// По образцу CloudShop «Движение товара» — но у нас деньги/накладные
// тоже туда попадают, потому что оператору важнее видеть один поток,
// чем ходить по 4 разным экранам.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  ShoppingCart,
  ClipboardCheck,
  Truck,
  TrendingDown,
  Undo2,
  FileText,
  Wallet,
  Search,
} from 'lucide-react'
import { Card, Button, Badge, Field, Input, Select, Empty, cx } from '../components/ui'
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

function ICON_FOR(kind) {
  return {
    'goods-in': ArrowDownToLine,
    'goods-out': ArrowUpFromLine,
    'goods-transfer': ArrowLeftRight,
    'goods-inv': ClipboardCheck,
    'money-in': ArrowDownToLine,
    'money-out': ArrowUpFromLine,
    'money-transfer': ArrowLeftRight,
    other: FileText,
  }[kind] || FileText
}

function TONE_FOR(kind) {
  if (kind.startsWith('goods-in') || kind === 'money-in') return 'ok'
  if (kind.startsWith('goods-out') || kind === 'money-out') return 'bad'
  return 'info'
}

// Собрать timeline из 4 источников.
function buildTimeline(state) {
  const rows = []
  for (const d of state.documents || []) {
    if (d.status === 'cancelled') continue
    rows.push({
      kind: 'doc',
      at: d.postedAt || d.createdAt,
      no: d.no,
      title: docTypeInfo(d.type).label,
      type: d.type,
      by: d.by,
      partyId: d.customerId || d.supplierId || null,
      qty: d.totalQty,
      sum: null,
      href: '#/operations',
      raw: d,
    })
  }
  for (const o of state.orders || []) {
    if (o.status === 'cancelled') continue
    rows.push({
      kind: 'order',
      at: o.createdAt,
      no: o.no,
      title: `Заказ · ${statusInfo(o.status).label}`,
      by: o.by,
      partyId: o.customerId,
      party: o.customerName,
      qty: (o.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
      sum: o.total,
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
      party: inv.party,
      qty: (inv.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
      sum: inv.total,
      href: '#/invoices',
      raw: inv,
    })
  }
  for (const t of state.moneyTx || []) {
    if (t.status === 'cancelled') continue
    rows.push({
      kind: 'money',
      at: t.at,
      no: t.no,
      title: purposeLabel(t.type, t.purpose),
      by: t.by,
      partyId: t.customerId || t.supplierId || null,
      accountId: t.accountId,
      toAccountId: t.toAccountId,
      qty: null,
      sum: t.amount,
      href: '#/money',
      raw: t,
    })
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1))
  return rows
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

  const timeline = useMemo(() => buildTimeline(state), [state])
  const range = useMemo(() => rangeFor(period), [period])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return timeline.filter((r) => {
      // Период
      if (range.from && r.at < range.from) return false
      if (range.to && r.at > range.to) return false
      // Тип
      const cls = classify(r)
      if (kind !== 'all' && !cls.startsWith(kind.replace('goods-', 'goods-').replace('money-', 'money-')) && cls !== kind) return false
      // Сотрудник
      if (empId !== 'all' && r.by !== empId) return false
      // Контрагент
      if (partyId !== 'all' && r.partyId !== partyId) return false
      // Счёт (только для money-строк — обычные документы не считаем «мимо кассы»)
      if (accId !== 'all' && r.kind === 'money' && r.accountId !== accId && r.toAccountId !== accId) return false
      if (accId !== 'all' && r.kind !== 'money') return false
      // Поиск
      if (s) {
        const hay = `${r.no} ${r.title} ${r.party || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [timeline, range, kind, empId, partyId, accId, q])

  // Сводки за фильтр
  const summary = useMemo(() => {
    let goodsIn = 0, goodsOut = 0, moneyIn = 0, moneyOut = 0
    for (const r of filtered) {
      const c = classify(r)
      if (r.kind === 'money') {
        if (c === 'money-in') moneyIn += r.sum || 0
        else if (c === 'money-out') moneyOut += r.sum || 0
      } else {
        if (c === 'goods-in') goodsIn += r.qty || 0
        else if (c === 'goods-out') goodsOut += r.qty || 0
      }
    }
    return { goodsIn, goodsOut, moneyIn, moneyOut }
  }, [filtered])

  const nameOf = (id) => employees.find((e) => e.id === id)?.name || '—'
  const partyName = (r) =>
    r.party ||
    customers.find((c) => c.id === r.partyId)?.name ||
    suppliers.find((s) => s.id === r.partyId)?.name ||
    ''

  return (
    <div className="animate-fadeUp space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Движение товара</h2>
        <p className="text-sm text-muted">
          Все документы, заказы, накладные и деньги — в одной ленте с фильтрами.
        </p>
      </div>

      {/* Фильтр по типу — верхние табы */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {KIND_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setKind(t.key)}
            className={cx(
              'px-3.5 h-9 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
              kind === t.key
                ? 'bg-brand text-brand-ink'
                : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Сводки за период (по фильтру) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Mini label="Приход товара" value={`${num(summary.goodsIn)} ед.`} tone="ok" />
        <Mini label="Расход товара" value={`${num(summary.goodsOut)} ед.`} tone="bad" />
        <Mini label="Приход денег" value={money(summary.moneyIn)} tone="ok" />
        <Mini label="Расход денег" value={money(summary.moneyOut)} tone="bad" />
      </div>

      {/* Панель фильтров */}
      <Card className="p-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <Field label="Период">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Сотрудник">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="all">Все</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Контрагент">
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
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
          <Field label="Поиск">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Номер, контрагент…"
                className="pl-9"
              />
            </div>
          </Field>
        </div>
      </Card>

      {/* Лента */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <Empty
            icon={BarChart3}
            title="Ничего не найдено"
            text="Смените период или сбросьте фильтры."
          />
        ) : (
          <div className="divide-y divide-line">
            {filtered.slice(0, 500).map((r, i) => {
              const cls = classify(r)
              const Icon = ICON_FOR(cls)
              const tone = TONE_FOR(cls)
              return (
                <a
                  key={`${r.kind}-${r.no}-${i}`}
                  href={r.href}
                  className="flex items-center gap-3 p-3.5 hover:bg-surface-2/60 transition no-underline text-inherit"
                >
                  <div
                    className={cx(
                      'h-9 w-9 rounded-lg grid place-items-center shrink-0',
                      tone === 'ok'
                        ? 'bg-ok-soft text-ok'
                        : tone === 'bad'
                          ? 'bg-bad-soft text-bad'
                          : 'bg-info-soft text-info',
                    )}
                  >
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium flex items-center gap-2 flex-wrap">
                      <span>{r.title}</span>
                      <Badge tone="brand" className="text-[10px]">{r.no}</Badge>
                    </div>
                    <div className="text-[11.5px] text-muted mt-0.5 truncate">
                      {new Date(r.at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {r.by && ` · ${nameOf(r.by)}`}
                      {partyName(r) && ` · ${partyName(r)}`}
                    </div>
                  </div>
                  {r.qty != null && (
                    <div className="text-[13px] tabular-nums shrink-0 text-muted">
                      {num(r.qty)} ед.
                    </div>
                  )}
                  {r.sum != null && (
                    <div
                      className={cx(
                        'text-[15px] font-semibold tabular-nums shrink-0',
                        tone === 'ok'
                          ? 'text-ok'
                          : tone === 'bad'
                            ? 'text-bad'
                            : 'text-info',
                      )}
                    >
                      {money(r.sum)}
                    </div>
                  )}
                </a>
              )
            })}
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

function Mini({ label, value, tone = 'brand' }) {
  const cls =
    tone === 'ok'
      ? 'text-ok bg-ok-soft/40'
      : tone === 'bad'
        ? 'text-bad bg-bad-soft/40'
        : 'text-brand bg-brand-soft/40'
  return (
    <div className={cx('rounded-xl p-3', cls)}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
