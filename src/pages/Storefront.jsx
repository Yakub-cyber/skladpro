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
  User,
  MapPin,
  Phone,
  Mail,
  Truck,
} from 'lucide-react'
import { Card, Button, Badge, Modal, Field, Input, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo, priceFor } from '../lib/constants'
import { reservedByProduct, availableStock } from '../lib/orders'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

export default function Storefront() {
  const { products, priceTypes, orders, addOrder, addCustomer } = useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [cart, setCart] = useState({})
  const [cartOpen, setCartOpen] = useState(false)
  const [placed, setPlaced] = useState(null)

  // Доступно клиенту = остаток − резерв открытых заказов. Витрина не должна
  // продавать зарезервированное, поэтому фильтр/лимиты — по доступному.
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const availOf = (p) => availableStock(p, reserved)

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ = !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
      return okC && okQ && availOf(p) > 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, q, cat, reserved])

  const cartRows = Object.entries(cart)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id), qty }))
    .filter((r) => r.p)
  const total = cartRows.reduce((a, r) => a + priceFor(r.p, defType) * r.qty, 0)
  const count = cartRows.reduce((a, r) => a + r.qty, 0)

  const setQty = (id, qty) =>
    setCart((c) => {
      const n = { ...c }
      const max = availOf(products.find((p) => p.id === id) || {})
      const capped = Math.min(qty, Math.max(0, max)) // не даём заказать больше доступного
      if (capped <= 0) delete n[id]
      else n[id] = capped
      return n
    })

  const checkout = (form) => {
    const name = form.shop?.trim() || form.fio.trim()
    addCustomer({
      name,
      contact: form.fio.trim(),
      type: form.shop ? 'Магазин' : 'Розница',
      city: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    })
    const cust = useStore.getState().customers[0]
    addOrder({
      customerId: cust.id,
      customerName: name,
      items: cartRows.map((r) => ({
        productId: r.p.id,
        name: r.p.name,
        qty: r.qty,
        price: priceFor(r.p, defType),
        unit: r.p.unit,
        cell: r.p.cell,
      })),
      total,
      priceTypeId: defType,
      address: form.address.trim(),
      courier: 'Доставка',
    })
    const fresh = useStore.getState().orders[0]
    setPlaced(fresh)
    setCart({})
    setCartOpen(false)
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
        <div className="card p-4 mt-5 text-left space-y-2">
          <p className="text-sm text-muted flex items-center gap-2">
            <Truck size={15} className="text-brand" /> Заказ добавлен в раздел «Доставка» и виден на карте маршрутов.
          </p>
          <Link to={`/track/${placed.id}`} className="flex items-center gap-2 text-brand font-medium text-sm break-all">
            <ExternalLink size={15} /> Ссылка для клиента: /track/{placed.id}
          </Link>
        </div>
        <div className="flex flex-wrap gap-2 justify-center mt-5">
          <Button variant="soft" onClick={() => setPlaced(null)}>
            Вернуться в витрину
          </Button>
          <Link to="/delivery">
            <Button variant="soft" icon={Truck}>На карту доставки</Button>
          </Link>
          <Link to={`/track/${placed.id}`}>
            <Button icon={Eye}>Трекинг</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeUp">
      {/* Баннер с корзиной */}
      <div className="rounded-2xl bg-gradient-to-r from-brand to-info p-5 mb-5 text-white relative overflow-hidden">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <Badge className="bg-white/20 text-white mb-2">
              <Store size={12} /> Так заказывают ваши клиенты
            </Badge>
            <h2 className="text-2xl font-semibold">Оптовая витрина СкладПро</h2>
            <p className="text-white/85 text-sm mt-1">
              Каталог с актуальными остатками. Заказ создаётся в системе и сразу на карте доставки.
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative shrink-0 h-12 w-12 rounded-xl bg-white/20 hover:bg-white/30 grid place-items-center transition"
          >
            <ShoppingCart size={22} />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-5 min-w-5 px-1 rounded-full bg-white text-brand text-[12px] font-bold grid place-items-center">
                {count}
              </span>
            )}
          </button>
        </div>
        <Store size={160} className="absolute -right-6 -bottom-10 text-white/10" />
      </div>

      {/* Поиск + категории */}
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
          <Chip active={cat === 'all'} onClick={() => setCat('all')}>Все</Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
              {c.key}
            </Chip>
          ))}
        </div>
      </div>

      {/* Сетка товаров */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {list.map((p) => {
          const c = catInfo(p.category)
          const Icon = CAT_ICON[c.icon] || Package
          const inCart = cart[p.id] || 0
          const price = priceFor(p, defType)
          return (
            <Card key={p.id} className="p-4 flex flex-col">
              {p.image ? (
                <img src={p.image} alt={p.name} className="h-24 w-full rounded-xl object-cover mb-3" />
              ) : (
                <div className="h-24 rounded-xl grid place-items-center mb-3" style={{ background: `color-mix(in srgb, ${c.color} 12%, transparent)` }}>
                  <Icon size={34} style={{ color: c.color }} />
                </div>
              )}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px]" style={{ color: c.color }}>{p.category}</span>
                {p.weighted && <Scale size={12} className="text-info" />}
                {p.marked && <ShieldCheck size={12} className="text-ok" />}
              </div>
              <div className="font-medium text-sm leading-snug flex-1">{p.name}</div>
              <div className="flex items-center justify-between mt-2">
                <div>
                  <div className="font-semibold tabular-nums">
                    {money(price)}
                    {p.weighted && <span className="text-[11px] text-muted font-normal"> /кг</span>}
                  </div>
                  <div className="text-[11px] text-ok">В наличии: {num(availOf(p))} {p.unit}</div>
                </div>
                {inCart ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setQty(p.id, inCart - 1)} className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3">
                      <Minus size={15} />
                    </button>
                    <span className="w-6 text-center text-sm font-medium tabular-nums">{inCart}</span>
                    <button
                      onClick={() => setQty(p.id, inCart + 1)}
                      disabled={inCart >= availOf(p)}
                      className="h-8 w-8 rounded-lg bg-brand text-brand-ink grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                ) : (
                  <Button size="sm" icon={Plus} onClick={() => setQty(p.id, 1)}>В корзину</Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}

      {/* Плавающая кнопка корзины */}
      {count > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 right-5 z-40 h-14 px-5 rounded-2xl bg-brand text-brand-ink shadow-xl shadow-brand/30 flex items-center gap-2 font-medium animate-fadeUp"
        >
          <ShoppingCart size={20} />
          {count} · {money(total)}
        </button>
      )}

      <CartModal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        rows={cartRows}
        priceType={defType}
        total={total}
        setQty={setQty}
        onCheckout={checkout}
      />
    </div>
  )
}

function CartModal({ open, onClose, rows, priceType, total, setQty, onCheckout }) {
  const [form, setForm] = useState({ fio: '', shop: '', address: '', phone: '', email: '' })
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }))

  const submit = () => {
    if (!rows.length) return
    if (!form.fio.trim()) return setErr('Укажите ФИО')
    if (!form.address.trim()) return setErr('Укажите адрес доставки')
    if (!/^[\d+\-() ]{6,}$/.test(form.phone.trim())) return setErr('Укажите телефон')
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErr('Укажите корректный email')
    setErr('')
    onCheckout(form)
    setForm({ fio: '', shop: '', address: '', phone: '', email: '' })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Корзина"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Продолжить покупки</Button>
          <Button icon={Check} onClick={submit} disabled={!rows.length}>
            Оформить · {money(total)}
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty icon={ShoppingCart} title="Корзина пуста" text="Добавьте товары из каталога." />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.p.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{r.p.name}</div>
                  <div className="text-[12px] text-muted">{money(priceFor(r.p, priceType))} × {r.qty}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setQty(r.p.id, r.qty - 1)} className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3">
                    <Minus size={14} />
                  </button>
                  <span className="w-6 text-center text-sm tabular-nums">{r.qty}</span>
                  <button onClick={() => setQty(r.p.id, r.qty + 1)} className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3">
                    <Plus size={14} />
                  </button>
                </div>
                <span className="w-24 text-right text-sm font-medium tabular-nums">
                  {money(priceFor(r.p, priceType) * r.qty)}
                </span>
                <button onClick={() => setQty(r.p.id, 0)} className="text-muted hover:text-bad">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-1">
            <span className="text-muted text-sm">Итого</span>
            <span className="text-xl font-semibold tabular-nums">{money(total)}</span>
          </div>

          {/* Данные клиента — обязательны */}
          <div className="border-t border-line pt-4 space-y-3">
            <h4 className="font-semibold text-sm">Данные для оформления</h4>
            <div className="grid sm:grid-cols-2 gap-3">
              <FormField icon={User} label="ФИО *" value={form.fio} onChange={(v) => set('fio', v)} placeholder="Иванов Иван" />
              <FormField icon={Store} label="Магазин (если есть)" value={form.shop} onChange={(v) => set('shop', v)} placeholder="ООО «...»" />
              <FormField icon={MapPin} label="Адрес доставки *" value={form.address} onChange={(v) => set('address', v)} placeholder="Город, улица, дом" />
              <FormField icon={Phone} label="Телефон *" value={form.phone} onChange={(v) => set('phone', v)} placeholder="+7 ..." />
              <FormField icon={Mail} label="Email *" value={form.email} onChange={(v) => set('email', v)} placeholder="mail@example.ru" className="sm:col-span-2" />
            </div>
            {err && <div className="text-[13px] text-bad">{err}</div>}
          </div>
        </div>
      )}
    </Modal>
  )
}

function FormField({ icon: Icon, label, value, onChange, placeholder, className }) {
  return (
    <Field label={label} className={className}>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
      </div>
    </Field>
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
