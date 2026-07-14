import { useEffect, useMemo, useRef, useState } from 'react'
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
  Camera,
  X,
  UserPlus,
} from 'lucide-react'
import { Card, Button, Badge, Field, Select, Input, Modal, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo, priceFor } from '../lib/constants'
import { resolveScan } from '../lib/barcode'
import { reservedByProduct } from '../lib/orders'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

// Единое поле «Поиск / штрихкод» + иконка камеры справа. Убирает вторую
// строку с большим ScannerInput наверху страницы — а весь ввод (текст /
// USB-сканер / камера) идёт в одно место. Автосабмит по Enter: если строка
// похожа на штрихкод (8+ цифр) — идёт в onScan, иначе просто поиск.
function SmartFind({ query, setQuery, onScan, msg }) {
  const [cam, setCam] = useState(false)
  const [camErr, setCamErr] = useState('')
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const hasDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const trySubmit = () => {
    const v = query.trim()
    if (/^\d{8,}$/.test(v)) {
      onScan(v)
      setQuery('')
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!cam) return
    let raf
    let detector
    let stopped = false
    ;(async () => {
      try {
        detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
        })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes[0]?.rawValue) {
              onScan(String(codes[0].rawValue))
              setCam(false)
              return
            }
          } catch {}
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setCamErr('Камера недоступна. Используйте сканер или ручной ввод.')
        setCam(false)
      }
    })()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [cam, onScan])

  return (
    <div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trySubmit()}
          placeholder="Поиск товара или штрихкод…"
          className="w-full h-11 pl-9 pr-12 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-[15px]"
          autoFocus
        />
        {hasDetector && (
          <button
            onClick={() => {
              setCamErr('')
              setCam((v) => !v)
            }}
            title={cam ? 'Закрыть камеру' : 'Сканировать камерой'}
            className={cx(
              'absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-9 rounded-lg grid place-items-center transition',
              cam ? 'bg-bad text-white' : 'bg-surface hover:bg-surface-3 text-muted',
            )}
          >
            {cam ? <X size={16} /> : <Camera size={16} />}
          </button>
        )}
      </div>
      {camErr && <div className="mt-2 text-[12px] text-bad">{camErr}</div>}
      {msg && <div className="mt-2 text-[12px] text-bad">{msg}</div>}
      {cam && (
        <div className="mt-3 relative rounded-xl overflow-hidden border border-brand/40 bg-black aspect-video max-w-md">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-1/3 border-2 border-brand rounded-lg" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center text-white text-[12px]">
            Наведите камеру на штрихкод
          </div>
        </div>
      )}
    </div>
  )
}

// Карточка товара в каталоге. Если товар уже в чеке — управляем количеством
// прямо здесь (`[−] N [+]`), не приходится скроллить вниз к чеку. Убирает
// главную боль мобильного UX «выбрал → нужно скроллить чек и там менять qty».
function ProductTile({ p, availOf, priceTypeId, row, onAdd, onSetQty, round3 }) {
  const c = catInfo(p.category)
  const Icon = CAT_ICON[c.icon] || Package
  const step = p.weighted ? 0.1 : 1
  const total = row ? row.qty * row.price : 0

  const clickCard = () => !row && onAdd(p)

  return (
    <div
      role={row ? undefined : 'button'}
      onClick={clickCard}
      className={cx(
        'card p-3 text-left transition relative flex flex-col gap-2',
        row ? 'border-brand' : 'hover:border-brand/50 cursor-pointer',
      )}
    >
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
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug line-clamp-2 flex items-center gap-1">
            {p.name}
            {p.weighted && <Scale size={11} className="text-info shrink-0" />}
            {p.marked && <ShieldCheck size={11} className="text-ok shrink-0" />}
          </div>
        </div>
      </div>
      {row ? (
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, round3(row.qty - step))
            }}
            className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            value={row.qty}
            min={p.weighted ? '0.001' : '1'}
            step={step}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetQty(row.productId, Math.max(0, +e.target.value))}
            className="w-14 h-8 px-1 rounded-lg bg-surface border border-line text-sm text-center"
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, round3(row.qty + step))
            }}
            className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            <Plus size={14} />
          </button>
          <span className="ml-auto text-sm font-semibold tabular-nums">{money(total)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, 0)
            }}
            title="Убрать"
            className="h-8 w-8 rounded-lg text-muted hover:text-bad hover:bg-surface-2 grid place-items-center"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm tabular-nums">
            {money(priceFor(p, priceTypeId))}
            {p.weighted && <span className="text-[10px] text-muted font-normal">/кг</span>}
          </span>
          <span className={cx('text-[11px]', availOf(p) <= 0 ? 'text-bad font-medium' : 'text-muted')}>
            дост. {num(availOf(p))}
          </span>
        </div>
      )}
    </div>
  )
}

// Компактный «Клиент»: селект + кнопка «+», раскрывающая мини-форму
// прямо здесь, без ухода в раздел «Клиенты». Заполнил имя+телефон →
// клиент добавлен и уже выбран.
function CustomerPicker({ customers, customerId, onPick, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', phone: '', city: '' })
  const save = () => {
    const name = f.name.trim()
    if (!name) return
    const id = onAdd({ name, phone: f.phone.trim(), city: f.city.trim() })
    if (id) onPick(id)
    setF({ name: '', phone: '', city: '' })
    setAdding(false)
  }
  return (
    <div>
      <div className="flex gap-1.5">
        <Select value={customerId} onChange={(e) => onPick(e.target.value)} className="flex-1">
          <option value="">Розничный</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="Новый клиент"
          className={cx(
            'h-10 w-10 rounded-xl grid place-items-center border transition shrink-0',
            adding ? 'bg-brand text-brand-ink border-brand' : 'bg-surface-2 border-line hover:text-brand',
          )}
        >
          {adding ? <X size={16} /> : <UserPlus size={16} />}
        </button>
      </div>
      {adding && (
        <div className="mt-2 p-3 rounded-xl bg-surface-2 border border-line space-y-2 animate-fadeUp">
          <Input
            placeholder="Имя / название компании *"
            value={f.name}
            onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Телефон"
              value={f.phone}
              onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))}
            />
            <Input
              placeholder="Город"
              value={f.city}
              onChange={(e) => setF((s) => ({ ...s, city: e.target.value }))}
            />
          </div>
          <Button icon={Check} className="w-full" onClick={save} disabled={!f.name.trim()} size="sm">
            Добавить и выбрать
          </Button>
        </div>
      )}
    </div>
  )
}

// Общая форма итога чека (клиент, скидка, кнопка). Рендерится и в
// sticky-сайдбаре на десктопе, и в bottom-sheet на мобиле.
function CartBody({
  rows,
  count,
  subtotal,
  total,
  discount,
  setDiscount,
  onCredit,
  setOnCredit,
  customerId,
  customers,
  onPickCustomer,
  onAddCustomer,
  priceTypeId,
  priceTypes,
  onChangeType,
  onSetQty,
  onSubmit,
  round3,
  compact = false,
}) {
  return (
    <div className={cx('flex flex-col', compact ? 'gap-3' : 'gap-3 h-full')}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Клиент">
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            onPick={onPickCustomer}
            onAdd={onAddCustomer}
          />
        </Field>
        <Field label="Цены">
          <Select value={priceTypeId} onChange={(e) => onChangeType(e.target.value)}>
            {priceTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={cx('flex-1 min-h-[80px]', !compact && 'overflow-y-auto no-scrollbar -mx-1 px-1')}>
        {rows.length === 0 ? (
          <Empty icon={ShoppingCart} title="Чек пуст" text="Добавьте товары из каталога." />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.productId} className="p-2.5 rounded-xl bg-surface-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium leading-snug">{r.name}</span>
                  <button onClick={() => onSetQty(r.productId, 0)} className="text-muted hover:text-bad shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => onSetQty(r.productId, round3(r.qty - (r.weighted ? 0.1 : 1)))}
                    className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    value={r.qty}
                    min={r.weighted ? '0.001' : '1'}
                    step={r.weighted ? '0.1' : '1'}
                    onChange={(e) => onSetQty(r.productId, Math.max(0, +e.target.value))}
                    className="w-14 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-center"
                  />
                  <button
                    onClick={() => onSetQty(r.productId, round3(r.qty + (r.weighted ? 0.1 : 1)))}
                    className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3"
                  >
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

      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={onCredit}
              onChange={(e) => setOnCredit(e.target.checked)}
              className="accent-[var(--brand)] w-4 h-4"
            />
            В долг
          </label>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[12px] text-muted">Скидка</span>
            <input
              type="number"
              min="0"
              max="100"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-14 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-center"
            />
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
          <span className="text-muted text-sm">
            Итого {onCredit && <span className="text-bad">· в долг</span>}
          </span>
          <span className="text-xl font-semibold tabular-nums">{money(total)}</span>
        </div>
        <Button icon={Check} className="w-full" onClick={onSubmit} disabled={!rows.length}>
          Оформить заказ
        </Button>
      </div>
    </div>
  )
}

export default function NewOrder() {
  const nav = useNavigate()
  const { customers, products, priceTypes, addOrder, addCustomer, orders } = useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const availOf = (p) => (p.stock || 0) - (reserved[p.id] || 0)

  const [customerId, setCustomerId] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [onCredit, setOnCredit] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [msg, setMsg] = useState('')
  const [mobileCart, setMobileCart] = useState(false) // bottom-sheet чека

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
    const inCart = rows.find((x) => x.productId === p.id)?.qty || 0
    if (inCart + qty > availOf(p)) {
      setMsg(
        `«${p.name}»: доступно ${num(Math.max(0, availOf(p)))} ${p.unit} (остальное в резерве) — заказ всё равно можно оформить`,
      )
    }
    setRows((r) =>
      r.find((x) => x.productId === p.id)
        ? r.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x))
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
  // Создание клиента inline. addCustomer в сторе не возвращает id — берём
  // свежесозданный из состояния (он всегда в начале списка).
  const createCustomer = (data) => {
    addCustomer(data)
    const fresh = useStore.getState().customers[0]
    return fresh?.id
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
  const rowsById = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.productId, r])),
    [rows],
  )

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
    setMobileCart(false)
    nav(`/orders?id=${fresh.id}`)
  }

  const cartProps = {
    rows,
    count,
    subtotal,
    total,
    discount,
    setDiscount,
    onCredit,
    setOnCredit,
    customerId,
    customers,
    onPickCustomer: selectCustomer,
    onAddCustomer: createCustomer,
    priceTypeId,
    priceTypes,
    onChangeType: changeType,
    onSetQty: setQty,
    onSubmit: submit,
    round3,
  }

  return (
    <div className="animate-fadeUp pb-24 lg:pb-0">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" icon={ArrowLeft} onClick={() => nav('/orders')} />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Новый заказ</h2>
          <p className="text-sm text-muted hidden sm:block">
            Касса: ищите или сканируйте товар — он попадёт в чек.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        {/* Каталог */}
        <div className="space-y-4 min-w-0">
          <SmartFind query={q} setQuery={setQ} onScan={onScan} msg={msg} />

          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            <Chip active={cat === 'all'} onClick={() => setCat('all')}>Все</Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
                {c.key}
              </Chip>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {list.map((p) => (
              <ProductTile
                key={p.id}
                p={p}
                availOf={availOf}
                priceTypeId={priceTypeId}
                row={rowsById[p.id]}
                onAdd={add}
                onSetQty={setQty}
                round3={round3}
              />
            ))}
          </div>
          {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}
        </div>

        {/* Чек — desktop sticky sidebar */}
        <Card className="hidden lg:flex p-4 lg:sticky lg:top-20 flex-col max-h-[calc(100dvh-6rem)]">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={18} className="text-brand" />
            <h3 className="font-semibold">Чек</h3>
            {count > 0 && <Badge tone="brand" className="ml-auto">{num(count)}</Badge>}
          </div>
          <CartBody {...cartProps} />
        </Card>
      </div>

      {/* Mobile: fixed bar снизу + модалка чека. На десктопе скрыт. */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur px-3 py-2 flex items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="relative">
            <ShoppingCart size={20} className="text-brand" />
            {count > 0 && (
              <span className="absolute -top-2 -right-2 h-4 min-w-4 px-1 rounded-full bg-brand text-brand-ink text-[10px] font-bold grid place-items-center">
                {num(count)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted leading-none">
              {rows.length ? `${rows.length} поз. · ${num(count)}` : 'Чек пуст'}
            </div>
            <div className="text-lg font-semibold tabular-nums leading-tight truncate">
              {money(total)}
            </div>
          </div>
        </div>
        <Button
          onClick={() => setMobileCart(true)}
          disabled={!rows.length}
          className="shrink-0"
          icon={Check}
        >
          Оформить
        </Button>
      </div>

      <Modal
        open={mobileCart}
        onClose={() => setMobileCart(false)}
        title={
          <span className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-brand" />
            Чек {count > 0 && <Badge tone="brand">{num(count)}</Badge>}
          </span>
        }
      >
        <CartBody {...cartProps} compact />
      </Modal>
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
