import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownToLine,
  TrendingDown,
  Undo2,
  ClipboardCheck,
  History,
  Search,
  Plus,
  Trash2,
  Check,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Scale,
  Eye,
  EyeOff,
  AlertTriangle,
  ShoppingCart,
  ArrowLeftRight,
  Truck,
  ChevronRight,
  FileText,
  Printer,
  Ban,
  FileEdit,
  Download,
} from 'lucide-react'
import { Card, Button, Badge, Field, Select, Empty, cx } from '../components/ui'
import ScannerInput from '../components/ScannerInput'
import { useStore } from '../store/useStore'
import { money, num, relTime } from '../lib/format'
import { statusInfo, docTypeInfo, DOC_STATUS } from '../lib/constants'
import { resolveScan } from '../lib/barcode'
import { downloadCsv } from '../lib/export'

// Иконка по типу документа
const DOC_ICON = {
  purchase: ArrowDownToLine,
  sale: ShoppingCart,
  sale_return: Undo2,
  supplier_return: Truck,
  transfer: ArrowLeftRight,
  writeoff: TrendingDown,
  inventory: ClipboardCheck,
}

const TABS = [
  { key: 'sale', label: 'Продажа', icon: ShoppingCart },
  { key: 'receive', label: 'Закупка', icon: ArrowDownToLine },
  { key: 'sreturn', label: 'Возврат продажи', icon: Undo2 },
  { key: 'preturn', label: 'Возврат поставщику', icon: Truck },
  { key: 'transfer', label: 'Перемещение', icon: ArrowLeftRight },
  { key: 'writeoff', label: 'Списание', icon: TrendingDown },
  { key: 'inventory', label: 'Инвентаризация', icon: ClipboardCheck },
  { key: 'registry', label: 'Реестр', icon: FileText },
  { key: 'marking', label: 'Маркировка', icon: ShieldCheck },
  { key: 'journal', label: 'Журнал', icon: History },
]

export default function Operations() {
  const [tab, setTab] = useState('sale')
  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Документы</h2>
        <p className="text-sm text-muted">
          Продажа, закупка, возвраты, перемещение, списание и инвентаризация — каждое движение пишется в журнал.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'flex items-center gap-2 px-3.5 h-10 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
              tab === t.key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'sale' && <SaleTab />}
      {tab === 'receive' && <ReceiveTab />}
      {tab === 'sreturn' && <ReturnTab />}
      {tab === 'preturn' && <SupplierReturnTab />}
      {tab === 'transfer' && <TransferTab />}
      {tab === 'writeoff' && <WriteOffTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'registry' && <DocumentsTab />}
      {tab === 'marking' && <MarkingTab />}
      {tab === 'journal' && <JournalTab />}
    </div>
  )
}

// ── Продажа (открывает кассу) ───────────────────────────────────────────────
function SaleTab() {
  const nav = useNavigate()
  const orders = useStore((s) => s.orders) || []
  const recent = useMemo(
    () => [...orders].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 8),
    [orders],
  )
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card className="p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <ShoppingCart size={17} className="text-brand" /> Новая продажа
        </h3>
        <p className="text-[13px] text-muted mb-4">
          Касса: сканируйте или ищите товар, выберите клиента и тип цены. Позиции спишутся со склада,
          а документ попадёт в журнал продаж и смену.
        </p>
        <Button icon={Plus} onClick={() => nav('/orders/new')}>
          Открыть кассу
        </Button>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">Последние продажи</h3>
        {recent.length === 0 ? (
          <Empty icon={ShoppingCart} title="Продаж пока нет" text="Оформите первую через кассу." />
        ) : (
          <div className="divide-y divide-line -mx-1">
            {recent.map((o) => {
              const si = statusInfo(o.status)
              return (
                <button
                  key={o.id}
                  onClick={() => nav(`/orders?id=${o.id}`)}
                  className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-surface-2 rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{o.customerName}</div>
                    <div className="text-[12px] text-muted">{o.no} · {relTime(o.createdAt)}</div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{money(o.total)}</span>
                  <Badge tone={si.color}>{si.label}</Badge>
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Возврат поставщику ──────────────────────────────────────────────────────
function SupplierReturnTab() {
  return (
    <MoveForm
      docType="supplier_return"
      reasons={['Брак от поставщика', 'Пересорт', 'Излишек поставки', 'Не востребован', 'Прочее']}
      tone="danger"
      verb="Вернуть поставщику"
      hint="Возврат поставщику уменьшает остаток на складе. Выберите товар, количество и причину — создаётся документ возврата."
    />
  )
}

// ── Перемещение между складами ──────────────────────────────────────────────
function TransferTab() {
  const warehouses = useStore((s) => s.warehouses) || []
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [toWh, setToWh] = useState(warehouses[0]?.id || '')
  const [done, setDone] = useState('')

  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '—'
  const add = (p) => {
    setDone('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, fromWh: p.warehouseId }],
    )
  }
  const submit = (post) => {
    addDocument({ type: 'transfer', toWarehouseId: toWh, items }, { post })
    setDone(post ? `Перемещено ${items.length} поз. → ${whName(toWh)}` : `Черновик перемещения на ${items.length} поз.`)
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5 max-w-xl">
      <p className="text-[13px] text-muted mb-3">
        Перемещение переносит товар на другой склад. Общий остаток не меняется — движение фиксируется в журнале.
      </p>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}

      <Field label="Склад назначения">
        <Select value={toWh} onChange={(e) => setToWh(e.target.value)}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
      </Field>

      <div className="mt-2">
        <ProductSearch onPick={add} placeholder="Добавить товар к перемещению…" />
      </div>

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          {items.map((it) => (
            <div key={it.productId} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{it.name}</div>
                <div className="text-[11px] text-muted flex items-center gap-1">
                  {whName(it.fromWh)} <ChevronRight size={11} /> {whName(toWh)}
                </div>
              </div>
              <input
                type="number"
                min="1"
                value={it.qty}
                onChange={(e) =>
                  setItems((arr) =>
                    arr.map((x) =>
                      x.productId === it.productId ? { ...x, qty: Math.max(1, +e.target.value) } : x,
                    ),
                  )
                }
                className="w-20 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
              />
              <span className="text-[12px] text-muted w-8">{it.unit}</span>
              <button
                onClick={() => setItems((arr) => arr.filter((x) => x.productId !== it.productId))}
                className="text-muted hover:text-bad"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <Button icon={ArrowLeftRight} className="flex-1" onClick={() => submit(true)} disabled={!toWh}>
              Переместить ({items.length})
            </Button>
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)} disabled={!toWh}>
              Черновик
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// Поиск товара (по названию/артикулу)
function ProductSearch({ onPick, placeholder = 'Найти товар по названию или артикулу…' }) {
  const products = useStore((s) => s.products)
  const [q, setQ] = useState('')
  const found = q
    ? products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.sku.toLowerCase().includes(q.toLowerCase()),
        )
        .slice(0, 6)
    : []
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
      />
      {found.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 card p-1 max-h-56 overflow-y-auto">
          {found.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onPick(p)
                setQ('')
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 h-10 rounded-lg hover:bg-surface-2 text-left text-sm"
            >
              <span className="truncate">{p.name}</span>
              <span className="text-muted text-[12px] shrink-0">
                {p.sku} · ост. {num(p.stock)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Toast({ children }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-ok-soft text-ok text-sm font-medium animate-fadeUp">
      <Check size={16} /> {children}
    </div>
  )
}

// ── Приёмка ─────────────────────────────────────────────────────────────────
function ReceiveTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000
  const add = (p, q = 1) => {
    setMsg('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + q) } : x))
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: q, weighted: p.weighted, cost: p.cost ?? 0 }],
    )
  }
  const onScan = (code) => {
    const r = resolveScan(code, products)
    if (!r) {
      setMsg(`Штрихкод «${code}» не найден в каталоге`)
      return
    }
    add(r.product, r.weighed ? r.weightKg : 1)
    if (r.weighed) setMsg(`Весовой: ${r.product.name} — ${r.weightKg} кг`)
  }
  const total = items.reduce((a, x) => a + x.qty, 0)
  const submit = (post) => {
    addDocument(
      {
        type: 'purchase',
        reason: 'Закупка',
        items: items.map((it) => ({ productId: it.productId, name: it.name, unit: it.unit, qty: it.qty, cost: it.cost })),
      },
      { post },
    )
    setDone(post ? `Оприходовано ${total} ед. в ${items.length} поз.` : `Черновик закупки на ${items.length} поз.`)
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <PackageCheck size={17} className="text-brand" /> Сканирование
        </h3>
        <ScannerInput onScan={onScan} />
        {msg && <div className="mt-2 text-[13px] text-bad">{msg}</div>}
        <div className="mt-4 pt-4 border-t border-line">
          <div className="text-[13px] text-muted mb-2">Или добавьте вручную:</div>
          <ProductSearch onPick={add} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Поступление</h3>
          {total > 0 && <Badge tone="brand">{total} ед.</Badge>}
        </div>
        {done && <Toast>{done}</Toast>}
        {items.length === 0 && !done ? (
          <Empty icon={ArrowDownToLine} title="Отсканируйте товар" text="Позиции появятся здесь." />
        ) : (
          <>
            <div className="space-y-2 max-h-[44vh] overflow-y-auto no-scrollbar">
              {items.map((it) => (
                <div key={it.productId} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-2">
                  <span className="flex-1 text-sm truncate">{it.name}</span>
                  <input
                    type="number"
                    min={it.weighted ? '0.001' : '1'}
                    step={it.weighted ? '0.001' : '1'}
                    value={it.qty}
                    onChange={(e) =>
                      setItems((arr) =>
                        arr.map((x) =>
                          x.productId === it.productId
                            ? { ...x, qty: Math.max(it.weighted ? 0.001 : 1, +e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="w-20 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted w-8">{it.unit}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.cost}
                    title="Цена закупки за единицу — обновит себестоимость (средневзвешенно)"
                    onChange={(e) =>
                      setItems((arr) =>
                        arr.map((x) =>
                          x.productId === it.productId ? { ...x, cost: Math.max(0, +e.target.value) } : x,
                        ),
                      )
                    }
                    className="w-24 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted">₽</span>
                  <button
                    onClick={() => setItems((arr) => arr.filter((x) => x.productId !== it.productId))}
                    className="text-muted hover:text-bad"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="flex gap-2 mt-4">
                <Button icon={Check} className="flex-1" onClick={() => submit(true)}>
                  Оприходовать на склад
                </Button>
                <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
                  Черновик
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// ── Списание / Возврат (общая форма документа на одну позицию) ─────────────
function MoveForm({ docType, reasons, tone, verb, hint }) {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [sel, setSel] = useState(null)
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(reasons[0])
  const [done, setDone] = useState('')

  const cur = sel && products.find((p) => p.id === sel.id)
  const [err, setErr] = useState('')
  const submit = (post) => {
    setErr('')
    const r = addDocument(
      { type: docType, reason, items: [{ productId: sel.id, name: sel.name, unit: sel.unit, qty }] },
      { post },
    )
    // addDocument возвращает id при успехе или { ok:false, error } при
    // превышении остатка на списании/продаже/возврате поставщику
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error)
      return
    }
    setDone(`${post ? verb : 'Черновик'}: ${sel.name} — ${qty} ${sel.unit}`)
    setSel(null)
    setQty(1)
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5 max-w-xl">
      <p className="text-[13px] text-muted mb-3">{hint}</p>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}
      <ProductSearch onPick={(p) => { setSel(p); setQty(1) }} />

      {sel && (
        <div className="mt-4 p-4 rounded-xl bg-surface-2 animate-fadeUp">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium">{sel.name}</div>
              <div className="text-[12px] text-muted flex items-center gap-1">
                <MapPin size={11} /> {sel.cell} · на складе {num(cur?.stock ?? sel.stock)} {sel.unit}
              </div>
            </div>
            <Badge tone="muted">{sel.sku}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество">
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(Math.max(1, +e.target.value))}
                className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand"
              />
            </Field>
            <Field label="Причина">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasons.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <Button className="flex-1" variant={tone} onClick={() => submit(true)} icon={Check}>
              {verb} {qty} {sel.unit}
            </Button>
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
              Черновик
            </Button>
          </div>
          {err && <div className="mt-3 text-[13px] text-bad">{err}</div>}
        </div>
      )}
    </Card>
  )
}

function WriteOffTab() {
  return (
    <MoveForm
      docType="writeoff"
      reasons={['Брак', 'Недостача', 'Порча', 'Истёк срок', 'Прочее']}
      tone="danger"
      verb="Списать"
      hint="Списание уменьшает остаток. Укажите товар, количество и причину — создаётся документ списания."
    />
  )
}

function ReturnTab() {
  return (
    <MoveForm
      docType="sale_return"
      reasons={['Возврат от клиента', 'Не подошёл', 'Брак у клиента', 'Пересорт', 'Прочее']}
      tone="primary"
      verb="Вернуть"
      hint="Возврат продажи увеличивает остаток на складе. Выберите товар, количество и причину возврата."
    />
  )
}

// ── Инвентаризация ──────────────────────────────────────────────────────────
function InventoryTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [counts, setCounts] = useState({})
  const [q, setQ] = useState('')
  const [done, setDone] = useState('')

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return products.filter(
      (p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s),
    )
  }, [products, q])

  const changed = Object.entries(counts).filter(([id, v]) => {
    const p = products.find((x) => x.id === id)
    return p && v !== '' && Number(v) !== p.stock
  })

  const submit = (post) => {
    const items = changed.map(([id, v]) => {
      const p = products.find((x) => x.id === id)
      return { productId: id, name: p.name, unit: p.unit, qty: Number(v), prevStock: p.stock }
    })
    addDocument({ type: 'inventory', reason: 'Инвентаризация', items }, { post })
    setDone(post ? `Применено по ${changed.length} позициям` : `Черновик инвентаризации на ${changed.length} поз.`)
    setCounts({})
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">Инвентаризация</h3>
          <p className="text-[13px] text-muted">Введите фактический остаток — система покажет расхождения.</p>
        </div>
        {changed.length > 0 && (
          <div className="flex gap-2">
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
              Черновик
            </Button>
            <Button icon={Check} onClick={() => submit(true)}>
              Применить ({changed.length})
            </Button>
          </div>
        )}
      </div>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}

      <div className="relative mb-3 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск товара…"
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-[12px] text-left border-b border-line">
              <th className="font-medium py-2 px-2">Товар</th>
              <th className="font-medium py-2 px-2 text-right">Учёт</th>
              <th className="font-medium py-2 px-2 text-right">Факт</th>
              <th className="font-medium py-2 px-2 text-right">Расхождение</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((p) => {
              const raw = counts[p.id]
              const fact = raw === '' || raw == null ? null : Number(raw)
              const diff = fact == null ? null : fact - p.stock
              return (
                <tr key={p.id}>
                  <td className="py-2 px-2">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] text-muted">{p.sku}</div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">
                    {num(p.stock)} {p.unit}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={raw ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                      placeholder={String(p.stock)}
                      className="w-20 h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm text-right outline-none focus:border-brand"
                    />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {diff == null || diff === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <Badge tone={diff > 0 ? 'ok' : 'bad'}>
                        {diff > 0 ? '+' : ''}
                        {num(diff)}
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Маркировка «Честный знак» ───────────────────────────────────────────────
function MarkingTab() {
  const { products, addMarkCodes } = useStore()
  const marked = products.filter((p) => p.marked)
  const [activeId, setActiveId] = useState(null)
  const [show, setShow] = useState({})

  if (!marked.length) {
    return (
      <Empty
        icon={ShieldCheck}
        title="Нет маркируемых товаров"
        text="Отметьте товар «Честный знак» в карточке товара — он появится здесь."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-info-soft text-info text-[13px]">
        <ShieldCheck size={16} className="shrink-0 mt-0.5" />
        <span>
          Сканируйте коды маркировки (DataMatrix) при приёмке. Коды выбывают из оборота при продаже.
          В норме число кодов = остатку.
        </span>
      </div>
      {marked.map((p) => {
        const n = p.codes?.length || 0
        const diff = p.stock - n
        const ok = diff === 0
        return (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-ok-soft text-ok grid place-items-center shrink-0">
                <ShieldCheck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-[12px] text-muted">{p.sku} · ост. {num(p.stock)} {p.unit}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] text-muted">Кодов КМ</div>
                <div className="font-semibold tabular-nums">{num(n)}</div>
              </div>
              <Badge tone={ok ? 'ok' : 'warn'}>
                {ok ? (
                  <>
                    <Check size={11} /> сходится
                  </>
                ) : (
                  <>
                    <AlertTriangle size={11} /> {diff > 0 ? `не хватает ${diff}` : `излишек ${-diff}`}
                  </>
                )}
              </Badge>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={activeId === p.id ? 'primary' : 'soft'}
                  icon={Plus}
                  onClick={() => setActiveId(activeId === p.id ? null : p.id)}
                >
                  Коды
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={show[p.id] ? EyeOff : Eye}
                  onClick={() => setShow((s) => ({ ...s, [p.id]: !s[p.id] }))}
                />
              </div>
            </div>

            {activeId === p.id && (
              <div className="mt-3 pt-3 border-t border-line animate-fadeUp">
                <ScannerInput
                  placeholder="Сканируйте код маркировки (DataMatrix)…"
                  onScan={(code) => addMarkCodes(p.id, [code])}
                />
              </div>
            )}

            {show[p.id] && n > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="text-[12px] text-muted mb-1.5">Коды в обороте ({n}):</div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {p.codes.slice(0, 50).map((c, i) => (
                    <div key={i} className="text-[11px] font-mono text-muted bg-surface-2 rounded px-2 py-1 truncate">
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ── Реестр документов ───────────────────────────────────────────────────────
const REG_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'posted', label: 'Проведённые' },
  { key: 'draft', label: 'Черновики' },
  { key: 'cancelled', label: 'Отменённые' },
]

// Печать документа в отдельном окне
function printDocument(doc, byName) {
  const ti = docTypeInfo(doc.type)
  const rows = (doc.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${it.name}</td><td style="text-align:right">${it.qty}</td><td>${it.unit || ''}</td></tr>`,
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${doc.no}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;padding:32px;}
      h1{font-size:20px;margin:0 0 4px}.muted{color:#666;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}
      th,td{border:1px solid #ccc;padding:8px 10px;text-align:left}th{background:#f3f3f3}
      .foot{margin-top:24px;font-size:13px;color:#444}
    </style></head><body>
    <h1>${ti.label} № ${doc.no}</h1>
    <div class="muted">${new Date(doc.createdAt).toLocaleString('ru-RU')} · ${byName}${doc.reason ? ' · ' + doc.reason : ''}</div>
    <table><thead><tr><th>#</th><th>Наименование</th><th style="text-align:right">Кол-во</th><th>Ед.</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="foot">Позиций: ${(doc.items || []).length} · Всего: ${doc.totalQty} · Статус: ${(DOC_STATUS[doc.status] || {}).label || doc.status}</div>
    </body></html>`
  const w = window.open('', '_blank', 'width=720,height=900')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}

function DocumentsTab() {
  const documents = useStore((s) => s.documents) || []
  const employees = useStore((s) => s.employees) || []
  const postDocument = useStore((s) => s.postDocument)
  const cancelDocument = useStore((s) => s.cancelDocument)
  const removeDocument = useStore((s) => s.removeDocument)
  const [filter, setFilter] = useState('all')
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  const list = filter === 'all' ? documents : documents.filter((d) => d.status === filter)

  if (!documents.length) {
    return (
      <Empty
        icon={FileText}
        title="Документов нет"
        text="Создайте закупку, списание, перемещение или другой документ — он появится в реестре с номером и статусом."
      />
    )
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
        {REG_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              'px-3 h-9 rounded-lg text-[13px] font-medium whitespace-nowrap',
              filter === f.key ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={FileText} title="Ничего не найдено" />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {list.map((d) => {
              const ti = docTypeInfo(d.type)
              const st = DOC_STATUS[d.status] || DOC_STATUS.posted
              const Icon = DOC_ICON[d.type] || FileText
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div
                    className={cx(
                      'h-9 w-9 rounded-lg grid place-items-center shrink-0',
                      d.status === 'cancelled' ? 'bg-surface-2 text-muted' : 'bg-brand-soft text-brand',
                    )}
                  >
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {d.no} · {ti.label}
                    </div>
                    <div className="text-[12px] text-muted">
                      {relTime(d.createdAt)} · {nameOf(d.by)} · {(d.items || []).length} поз. · {num(d.totalQty)} ед.
                    </div>
                  </div>
                  <Badge tone={st.color}>{st.label}</Badge>
                  <div className="flex items-center gap-1">
                    {d.status === 'draft' && (
                      <Button size="sm" variant="primary" icon={Check} onClick={() => postDocument(d.id)}>
                        Провести
                      </Button>
                    )}
                    {d.status === 'posted' && (
                      <Button size="sm" variant="ghost" icon={Ban} onClick={() => cancelDocument(d.id)}>
                        Отменить
                      </Button>
                    )}
                    <Button size="sm" variant="soft" icon={Printer} onClick={() => printDocument(d, nameOf(d.by))}>
                      Печать
                    </Button>
                    {d.status !== 'posted' && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeDocument(d.id)} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Журнал движений ─────────────────────────────────────────────────────────
const MV = {
  in: { label: 'Закупка', icon: ArrowDownToLine, tone: 'ok' },
  writeoff: { label: 'Списание', icon: TrendingDown, tone: 'bad' },
  return: { label: 'Возврат продажи', icon: Undo2, tone: 'info' },
  supplier_return: { label: 'Возврат поставщику', icon: Truck, tone: 'bad' },
  transfer: { label: 'Перемещение', icon: ArrowLeftRight, tone: 'info' },
  inventory: { label: 'Инвентаризация', icon: ClipboardCheck, tone: 'warn' },
}

function JournalTab() {
  const movements = useStore((s) => s.movements) || []
  const employees = useStore((s) => s.employees) || []
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  if (!movements.length) {
    return <Empty icon={History} title="Журнал пуст" text="Закупки, возвраты, перемещения, списания и инвентаризации появятся здесь." />
  }

  const exportCsv = () =>
    downloadCsv(`Движения-${new Date().toISOString().slice(0, 10)}`, movements, [
      { key: 'at', label: 'Дата', map: (v) => new Date(v).toLocaleString('ru-RU') },
      { key: 'type', label: 'Операция', map: (v) => (MV[v] || MV.in).label },
      { key: 'name', label: 'Товар' },
      { key: 'qty', label: 'Кол-во' },
      { key: 'delta', label: 'Изменение остатка' },
      { key: 'reason', label: 'Причина' },
      { key: 'by', label: 'Сотрудник', map: (v) => nameOf(v) },
    ])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-muted">
          Показаны последние {Math.min(movements.length, 100)} из {movements.length}
        </span>
        <Button variant="soft" size="sm" icon={Download} onClick={exportCsv}>
          Экспорт CSV
        </Button>
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-line">
          {movements.slice(0, 100).map((m) => {
            const info = MV[m.type] || MV.in
            return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className={cx('h-9 w-9 rounded-lg grid place-items-center shrink-0', `bg-${info.tone}-soft text-${info.tone}`)}>
                <info.icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.name}</div>
                <div className="text-[12px] text-muted">
                  {info.label} · {m.reason} · {nameOf(m.by)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={cx('text-sm font-semibold tabular-nums', m.delta === 0 ? 'text-muted' : m.delta > 0 ? 'text-ok' : 'text-bad')}>
                  {m.delta === 0 ? '↔' : `${m.delta > 0 ? '+' : ''}${num(m.delta)}`}
                </div>
                <div className="text-[11px] text-muted">{relTime(m.at)}</div>
              </div>
            </div>
          )
        })}
        </div>
      </Card>
    </>
  )
}
