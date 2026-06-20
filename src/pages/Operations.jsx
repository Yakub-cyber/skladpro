import { useMemo, useState } from 'react'
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
} from 'lucide-react'
import { Card, Button, Badge, Field, Select, Empty, cx } from '../components/ui'
import ScannerInput from '../components/ScannerInput'
import { useStore } from '../store/useStore'
import { money, num, relTime } from '../lib/format'
import { resolveScan } from '../lib/barcode'

const TABS = [
  { key: 'receive', label: 'Приёмка', icon: ArrowDownToLine },
  { key: 'writeoff', label: 'Списание', icon: TrendingDown },
  { key: 'return', label: 'Возврат', icon: Undo2 },
  { key: 'inventory', label: 'Инвентаризация', icon: ClipboardCheck },
  { key: 'marking', label: 'Маркировка', icon: ShieldCheck },
  { key: 'journal', label: 'Журнал', icon: History },
]

export default function Operations() {
  const [tab, setTab] = useState('receive')
  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Операции склада</h2>
        <p className="text-sm text-muted">
          Приёмка со сканером, списание, возврат и инвентаризация — всё пишется в журнал.
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

      {tab === 'receive' && <ReceiveTab />}
      {tab === 'writeoff' && <WriteOffTab />}
      {tab === 'return' && <ReturnTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'marking' && <MarkingTab />}
      {tab === 'journal' && <JournalTab />}
    </div>
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
  const { products, receiveOp } = useStore()
  const [items, setItems] = useState([])
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000
  const add = (p, q = 1) => {
    setMsg('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + q) } : x))
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: q, weighted: p.weighted }],
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
  const apply = () => {
    receiveOp(items, 'Приёмка на складе')
    setDone(`Оприходовано ${total} ед. в ${items.length} позициях`)
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
              <Button icon={Check} className="w-full mt-4" onClick={apply}>
                Оприходовать на склад
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// ── Списание / Возврат (общая форма) ───────────────────────────────────────
function MoveForm({ action, reasons, tone, verb, hint }) {
  const products = useStore((s) => s.products)
  const [sel, setSel] = useState(null)
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(reasons[0])
  const [done, setDone] = useState('')

  const cur = sel && products.find((p) => p.id === sel.id)
  const apply = () => {
    action(sel.id, qty, reason)
    setDone(`${verb}: ${sel.name} — ${qty} ${sel.unit}`)
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
          <Button
            className="w-full mt-4"
            variant={tone}
            onClick={apply}
            icon={Check}
          >
            {verb} {qty} {sel.unit}
          </Button>
        </div>
      )}
    </Card>
  )
}

function WriteOffTab() {
  const writeOff = useStore((s) => s.writeOff)
  return (
    <MoveForm
      action={writeOff}
      reasons={['Брак', 'Недостача', 'Порча', 'Истёк срок', 'Прочее']}
      tone="danger"
      verb="Списать"
      hint="Списание уменьшает остаток. Укажите товар, количество и причину — операция попадёт в журнал."
    />
  )
}

function ReturnTab() {
  const returnStock = useStore((s) => s.returnStock)
  return (
    <MoveForm
      action={returnStock}
      reasons={['Возврат от клиента', 'Не подошёл', 'Брак у клиента', 'Пересорт', 'Прочее']}
      tone="primary"
      verb="Вернуть"
      hint="Возврат увеличивает остаток на складе. Выберите товар, количество и причину возврата."
    />
  )
}

// ── Инвентаризация ──────────────────────────────────────────────────────────
function InventoryTab() {
  const { products, applyInventory } = useStore()
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

  const apply = () => {
    const payload = {}
    changed.forEach(([id, v]) => (payload[id] = Number(v)))
    applyInventory(payload)
    setDone(`Применено по ${changed.length} позициям`)
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
          <Button icon={Check} onClick={apply}>
            Применить ({changed.length})
          </Button>
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

// ── Журнал движений ─────────────────────────────────────────────────────────
const MV = {
  in: { label: 'Приёмка', icon: ArrowDownToLine, tone: 'ok' },
  writeoff: { label: 'Списание', icon: TrendingDown, tone: 'bad' },
  return: { label: 'Возврат', icon: Undo2, tone: 'info' },
  inventory: { label: 'Инвентаризация', icon: ClipboardCheck, tone: 'warn' },
}

function JournalTab() {
  const movements = useStore((s) => s.movements) || []
  const employees = useStore((s) => s.employees) || []
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  if (!movements.length) {
    return <Empty icon={History} title="Журнал пуст" text="Операции приёмки, списания и инвентаризации появятся здесь." />
  }

  return (
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
                <div className={cx('text-sm font-semibold tabular-nums', m.delta >= 0 ? 'text-ok' : 'text-bad')}>
                  {m.delta >= 0 ? '+' : ''}
                  {num(m.delta)}
                </div>
                <div className="text-[11px] text-muted">{relTime(m.at)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
