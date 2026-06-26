import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Store,
  Check,
  ExternalLink,
  Eye,
  Wrench,
  Hammer,
  Zap,
  Droplets,
  PaintBucket,
  Package,
  Scale,
  ShieldCheck,
} from 'lucide-react'
import { Card, Button, Badge, Select, Field, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo } from '../lib/constants'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

export default function Storefront() {
  const { products, customers, addOrder } = useStore()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [cart, setCart] = useState({})
  const [customerId, setCustomerId] = useState('')
  const [placed, setPlaced] = useState(null)

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ = !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
      return okC && okQ && p.stock > 0
    })
  }, [products, q, cat])

  const cartRows = Object.entries(cart)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id), qty }))
    .filter((r) => r.p)
  const total = cartRows.reduce((a, r) => a + r.p.price * r.qty, 0)
  const count = cartRows.reduce((a, r) => a + r.qty, 0)

  const setQty = (id, qty) =>
    setCart((c) => {
      const n = { ...c }
      if (qty <= 0) delete n[id]
      else n[id] = qty
      return n
    })

  const checkout = () => {
    const cust = customers.find((c) => c.id === customerId) || {
      id: 'guest',
      name: 'Гость (витрина)',
      city: 'Самовывоз',
    }
    addOrder({
      customerId: cust.id,
      customerName: cust.name,
      items: cartRows.map((r) => ({
        productId: r.p.id,
        name: r.p.name,
        qty: r.qty,
        price: r.p.price,
        unit: r.p.unit,
        cell: r.p.cell,
      })),
      total,
      address: cust.city,
      courier: 'Доставка',
    })
    const fresh = useStore.getState().orders[0]
    setPlaced(fresh)
    setCart({})
    setCustomerId('')
  }

  if (placed) {
    return (
      <div className="animate-fadeUp max-w-md mx-auto text-center py-10">
        <div className="h-16 w-16 rounded-2xl bg-ok-soft text-ok grid place-items-center mx-auto mb-4">
          <Check size={32} />
        </div>
        <h2 className="text-xl font-semibold">Заказ оформлен!</h2>
        <p className="text-muted mt-1">
          Номер <b className="text-ink">{placed.no}</b> на сумму {money(placed.total)}
        </p>
        <div className="card p-4 mt-5 text-left">
          <p className="text-sm text-muted mb-2">Ссылка для клиента — отслеживание статуса:</p>
          <Link
            to={`/track/${placed.id}`}
            className="flex items-center gap-2 text-brand font-medium text-sm break-all"
          >
            <ExternalLink size={15} /> /track/{placed.id}
          </Link>
        </div>
        <div className="flex gap-2 justify-center mt-5">
          <Button variant="soft" onClick={() => setPlaced(null)}>
            Вернуться в витрину
          </Button>
          <Link to={`/track/${placed.id}`}>
            <Button icon={Eye}>Открыть трекинг</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeUp">
      {/* Баннер витрины */}
      <div className="rounded-2xl bg-gradient-to-r from-brand to-info p-5 mb-5 text-white relative overflow-hidden">
        <div className="relative z-10">
          <Badge className="bg-white/20 text-white mb-2">
            <Store size={12} /> Так заказывают ваши клиенты
          </Badge>
          <h2 className="text-2xl font-semibold">Оптовая витрина СкладПро</h2>
          <p className="text-white/85 text-sm mt-1">
            Каталог с актуальными остатками и оптовыми ценами. Заказ создаётся прямо в системе.
          </p>
        </div>
        <Store size={160} className="absolute -right-6 -bottom-10 text-white/10" />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
              <Chip active={cat === 'all'} onClick={() => setCat('all')}>
                Все
              </Chip>
              {CATEGORIES.map((c) => (
                <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
                  {c.key}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {list.map((p) => {
              const c = catInfo(p.category)
              const Icon = CAT_ICON[c.icon] || Package
              const inCart = cart[p.id] || 0
              return (
                <Card key={p.id} className="p-4 flex flex-col">
                  {p.image ? (
                    <img
                      src={p.image}
                      alt={p.name}
                      className="h-24 w-full rounded-xl object-cover mb-3"
                    />
                  ) : (
                    <div
                      className="h-24 rounded-xl grid place-items-center mb-3"
                      style={{ background: `color-mix(in srgb, ${c.color} 12%, transparent)` }}
                    >
                      <Icon size={34} style={{ color: c.color }} />
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[11px]" style={{ color: c.color }}>
                      {p.category}
                    </span>
                    {p.weighted && <Scale size={12} className="text-info" />}
                    {p.marked && <ShieldCheck size={12} className="text-ok" />}
                  </div>
                  <div className="font-medium text-sm leading-snug flex-1">{p.name}</div>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <div className="font-semibold tabular-nums">
                        {money(p.price)}
                        {p.weighted && <span className="text-[11px] text-muted font-normal"> /кг</span>}
                      </div>
                      <div className="text-[11px] text-ok">В наличии: {num(p.stock)} {p.unit}</div>
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setQty(p.id, inCart - 1)}
                          className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
                        >
                          <Minus size={15} />
                        </button>
                        <span className="w-6 text-center text-sm font-medium tabular-nums">
                          {inCart}
                        </span>
                        <button
                          onClick={() => setQty(p.id, inCart + 1)}
                          className="h-8 w-8 rounded-lg bg-brand text-brand-ink grid place-items-center"
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    ) : (
                      <Button size="sm" icon={Plus} onClick={() => setQty(p.id, 1)}>
                        В корзину
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
          {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}
        </div>

        {/* Корзина */}
        <Card className="p-4 lg:sticky lg:top-20">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={18} className="text-brand" />
            <h3 className="font-semibold">Корзина</h3>
            {count > 0 && <Badge tone="brand" className="ml-auto">{count}</Badge>}
          </div>
          {cartRows.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">Корзина пуста</p>
          ) : (
            <>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto no-scrollbar mb-3">
                {cartRows.map((r) => (
                  <div key={r.p.id} className="flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{r.p.name}</div>
                      <div className="text-[12px] text-muted">
                        {r.qty} × {money(r.p.price)}
                      </div>
                    </div>
                    <span className="tabular-nums font-medium">{money(r.qty * r.p.price)}</span>
                    <button onClick={() => setQty(r.p.id, 0)} className="text-muted hover:text-bad">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-line pt-3 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted text-sm">Итого</span>
                  <span className="text-lg font-semibold tabular-nums">{money(total)}</span>
                </div>
                <Field label="Оформить от имени">
                  <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Гость / новый клиент</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button className="w-full" icon={Check} onClick={checkout}>
                  Оформить заказ
                </Button>
              </div>
            </>
          )}
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
