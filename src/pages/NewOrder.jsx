import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  Plus,
  Minus,
  Trash2,
  Check,
  ShoppingCart,
  Scale,
  ShieldCheck,
  Wrench,
  Hammer,
  Zap,
  Droplets,
  PaintBucket,
  Package,
} from 'lucide-react'
import { Card, Button, Badge, Field, Select, Empty, cx } from '../components/ui'
import ScannerInput from '../components/ScannerInput'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo, priceFor } from '../lib/constants'
import { resolveScan } from '../lib/barcode'
import { reservedByProduct } from '../lib/orders'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

export default function NewOrder() {
  const nav = useNavigate()
  const { customers, products, priceTypes, addOrder, orders } = useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  // Доступно к продаже = остаток − резерв открытых заказов
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const availOf = (p) => (p.stock || 0) - (reserved[p.id] || 0)

  const [customerId, setCustomerId] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [rows, setRows] = useState([]) // { productId, name, qty, price, unit, cell, weighted }
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [onCredit, setOnCredit] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [msg, setMsg] = useState('')

  const isCreditType = (id) =>
    priceTypes.find((t) => t.id === id)?.name.toLowerCase().includes('долг')

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ =
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags?.some((t) => t.includes(s))
      return okC && okQ
    })
  }, [products, q, cat])

  const round3 = (n) => Math.round(n * 1000) / 1000
  const add = (p, qty = 1) => {
    setMsg('')
    // мягкое предупреждение: доступное (с учётом резерва) уже выбрано в чек
    const inCart = rows.find((x) => x.productId === p.id)?.qty || 0
    if (inCart + qty > availOf(p)) {
      setMsg(`«${p.name}»: доступно ${num(Math.max(0, availOf(p)))} ${p.unit} (остальное в резерве) — заказ всё равно можно оформить`)
    }
    setRows((r) =>
      r.find((x) => x.productId === p.id)
        ? r.map((x) =>
            x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x,
          )
        : [
            ...r,
            {
              productId: p.id,
              name: p.name,
              qty,
              price: priceFor(p, priceTypeId),
              unit: p.unit,
              cell: p.cell,
              weighted: p.weighted,
            },
          ],
    )
  }
  const setQty = (id, qty) =>
    setRows((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )

  const selectCustomer = (id) => {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c?.priceTypeId) changeType(c.priceTypeId)
  }
  const changeType = (ptId) => {
    setPriceTypeId(ptId)
    setOnCredit(isCreditType(ptId))
    setRows((rr) =>
      rr.map((x) => {
        const p = products.find((pp) => pp.id === x.productId)
        return p ? { ...x, price: priceFor(p, ptId) } : x
      }),
    )
  }

  const onScan = (code) => {
    const r = resolveScan(code, products)
    if (!r) {
      setMsg(`Штрихкод «${code}» не найден`)
      return
    }
    add(r.product, r.weighed ? r.weightKg : 1)
  }

  const subtotal = rows.reduce((a, r) => a + r.qty * r.price, 0)
  const total = Math.round(subtotal * (1 - (Number(discount) || 0) / 100))
  const count = rows.reduce((a, r) => a + r.qty, 0)

  const submit = () => {
    if (!rows.length) return
    const cust = customers.find((c) => c.id === customerId)
    addOrder({
      customerId: cust?.id || 'retail',
      customerName: cust?.name || 'Розничный покупатель',
      items: rows,
      subtotal,
      discount: Number(discount) || 0,
      total,
      priceTypeId,
      onCredit,
      address: cust?.city || 'Самовывоз',
      courier: 'Самовывоз',
    })
    const fresh = useStore.getState().orders[0]
    nav(`/orders?id=${fresh.id}`)
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" icon={ArrowLeft} onClick={() => nav('/orders')} />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Новый заказ</h2>
          <p className="text-sm text-muted">Касса: ищите или сканируйте товар — он попадёт в чек.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        {/* Каталог */}
        <div className="space-y-4">
          <ScannerInput onScan={onScan} placeholder="Сканируйте штрихкод или введите код…" />
          {msg && <div className="text-[13px] text-bad">{msg}</div>}

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск товара…"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <Chip active={cat === 'all'} onClick={() => setCat('all')}>Все</Chip>
              {CATEGORIES.map((c) => (
                <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
                  {c.key}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {list.map((p) => {
              const c = catInfo(p.category)
              const Icon = CAT_ICON[c.icon] || Package
              const inOrder = rows.find((x) => x.productId === p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  className={cx(
                    'card p-3 text-left hover:border-brand/50 transition relative',
                    inOrder && 'border-brand',
                  )}
                >
                  {inOrder && (
                    <span className="absolute top-2 right-2 h-5 min-w-5 px-1 rounded-full bg-brand text-brand-ink text-[11px] font-bold grid place-items-center">
                      {num(inOrder.qty)}
                    </span>
                  )}
                  <div className="flex items-center gap-2.5">
                    {p.image ? (
                      <img src={p.image} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div
                        className="h-10 w-10 rounded-lg grid place-items-center shrink-0"
                        style={{ background: `color-mix(in srgb, ${c.color} 16%, transparent)`, color: c.color }}
                      >
                        <Icon size={18} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium leading-snug line-clamp-2 flex items-center gap-1">
                        {p.name}
                        {p.weighted && <Scale size={11} className="text-info shrink-0" />}
                        {p.marked && <ShieldCheck size={11} className="text-ok shrink-0" />}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-semibold text-sm tabular-nums">
                      {money(priceFor(p, priceTypeId))}
                      {p.weighted && <span className="text-[10px] text-muted font-normal">/кг</span>}
                    </span>
                    <span className={cx('text-[11px]', availOf(p) <= 0 ? 'text-bad font-medium' : 'text-muted')}>
                      дост. {num(availOf(p))}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}
        </div>

        {/* Чек */}
        <Card className="p-4 lg:sticky lg:top-20 flex flex-col max-h-[calc(100dvh-6rem)]">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={18} className="text-brand" />
            <h3 className="font-semibold">Чек</h3>
            {count > 0 && <Badge tone="brand" className="ml-auto">{num(count)}</Badge>}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <Field label="Клиент">
              <Select value={customerId} onChange={(e) => selectCustomer(e.target.value)}>
                <option value="">Розничный</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Цены">
              <Select value={priceTypeId} onChange={(e) => changeType(e.target.value)}>
                {priceTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 min-h-[80px]">
            {rows.length === 0 ? (
              <Empty icon={ShoppingCart} title="Чек пуст" text="Добавьте товары из каталога." />
            ) : (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.productId} className="p-2.5 rounded-xl bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium leading-snug">{r.name}</span>
                      <button onClick={() => setQty(r.productId, 0)} className="text-muted hover:text-bad shrink-0">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => setQty(r.productId, round3(r.qty - (r.weighted ? 0.1 : 1)))} className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3">
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        value={r.qty}
                        min={r.weighted ? '0.001' : '1'}
                        step={r.weighted ? '0.1' : '1'}
                        onChange={(e) => setQty(r.productId, Math.max(0, +e.target.value))}
                        className="w-14 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-center"
                      />
                      <button onClick={() => setQty(r.productId, round3(r.qty + (r.weighted ? 0.1 : 1)))} className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3">
                        <Plus size={14} />
                      </button>
                      <span className="text-[11px] text-muted">{r.unit}</span>
                      <span className="ml-auto text-sm font-medium tabular-nums">{money(r.qty * r.price)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Итог */}
          <div className="border-t border-line mt-3 pt-3 space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                <input type="checkbox" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} className="accent-[var(--brand)] w-4 h-4" />
                В долг
              </label>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[12px] text-muted">Скидка</span>
                <input type="number" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-14 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-center" />
                <span className="text-[12px] text-muted">%</span>
              </div>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-[12px] text-muted">
                <span>Без скидки</span>
                <span className="line-through tabular-nums">{money(subtotal)}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted text-sm">Итого {onCredit && <span className="text-bad">· в долг</span>}</span>
              <span className="text-xl font-semibold tabular-nums">{money(total)}</span>
            </div>
            <Button icon={Check} className="w-full" onClick={submit} disabled={!rows.length}>
              Оформить заказ
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'px-3 h-10 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
        active ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
