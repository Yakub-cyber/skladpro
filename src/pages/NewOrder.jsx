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
  User,
} from 'lucide-react'
import { Card, Button, Badge, Field, Select, Input, Modal, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo, priceFor } from '../lib/constants'
import { resolveScan } from '../lib/barcode'
import { reservedByProduct } from '../lib/orders'
import { computeKitStock } from '../lib/kit'

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
// Search-комбобокс клиента — вместо <Select> с 500+ опций (неюзабельно
// на клавиатуре и мыши). Ввод → фильтр по имени/телефону/ИНН. Стрелки
// вверх/вниз — навигация, Enter — выбор, Esc — сброс. Кнопка «+» рядом
// раскрывает мини-форму «новый клиент» (осталась как была).
function CustomerPicker({ customers, customerId, onPick, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', phone: '', city: '' })
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  // Свежесть отображаемого label когда customerId меняется извне.
  const selected = customers.find((c) => c.id === customerId)
  const showLabel = selected?.name || 'Розничный'

  const norm = (s) => (s || '').toLowerCase()
  const matches = useMemo(() => {
    const s = norm(q).trim()
    if (!s) return customers.slice(0, 8) // без запроса — топ последних
    return customers
      .filter((c) => {
        return (
          norm(c.name).includes(s) ||
          norm(c.phone).includes(s) ||
          norm(c.inn).includes(s) ||
          norm(c.contact).includes(s)
        )
      })
      .slice(0, 12)
  }, [customers, q])

  const pick = (id) => {
    onPick(id)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKey = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(matches.length, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // 0 = «Розничный» (первый пункт), дальше matches[i-1]
      if (active === 0) pick('')
      else if (matches[active - 1]) pick(matches[active - 1].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQ('')
      inputRef.current?.blur()
    }
  }

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
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={open ? q : showLabel}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              setQ('')
              setActive(0)
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKey}
            placeholder="Поиск: имя / телефон / ИНН…"
            className={cx(
              'w-full h-10 px-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm truncate',
              !open && !selected && 'text-muted',
            )}
          />
          {open && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl bg-surface border border-line shadow-xl max-h-[280px] overflow-y-auto py-1">
              {/* Первый пункт — «Розничный» (сброс выбора) */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick('')}
                className={cx(
                  'w-full flex items-center gap-2 px-3 h-10 text-left text-[13px] transition',
                  active === 0 ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
                )}
              >
                <User size={14} className="text-muted" />
                Розничный покупатель
              </button>
              {matches.length === 0 && q && (
                <div className="px-3 py-2 text-[12px] text-muted italic">
                  Не найдено. Нажмите «+», чтобы добавить нового.
                </div>
              )}
              {matches.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.id)}
                  className={cx(
                    'w-full flex items-center gap-2 px-3 h-11 text-left text-[13px] transition',
                    active === i + 1 ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {[c.type, c.city, c.phone].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {c.balance > 0 && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-warn-soft text-warn tabular-nums whitespace-nowrap">
                      долг {money(c.balance)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
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
  onSetPrice,
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
            {rows.map((r) => {
              const base = Number(r.basePrice ?? r.price) || 0
              const price = Number(r.price) || 0
              const discounted = base > 0 && price < base
              return (
                <div key={r.productId} className="p-2.5 rounded-xl bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">{r.name}</span>
                    <button onClick={() => onSetQty(r.productId, 0)} className="text-muted hover:text-bad shrink-0">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {/* Строка 1: qty */}
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
                    <span className="ml-auto text-sm font-medium tabular-nums">
                      {money(r.qty * price)}
                    </span>
                  </div>
                  {/* Строка 2: цена (редактируемая) + база зачёркнутой если снижена */}
                  {onSetPrice && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] text-muted">Цена</span>
                      <input
                        type="number"
                        value={r.price}
                        min="0"
                        step="0.01"
                        onChange={(e) => onSetPrice(r.productId, e.target.value)}
                        className={cx(
                          'w-24 h-7 px-2 rounded-lg bg-surface border text-sm text-right tabular-nums',
                          discounted ? 'border-ok text-ok font-medium' : 'border-line',
                        )}
                        title="Персональная цена по этой позиции"
                      />
                      <span className="text-[11px] text-muted">₽/{r.unit}</span>
                      {discounted && (
                        <span className="ml-auto text-[11px] text-muted line-through tabular-nums">
                          {money(base)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center gap-3">
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
          {discount > 0 && (
            <span className="ml-auto text-[12px] text-muted line-through tabular-nums">
              {money(subtotal)}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted text-sm">Итого</span>
          <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
        </div>
        {/* Крупная зелёная CTA на всю ширину чека — сумма на самой кнопке.
            F9 (в родителе) тоже открывает экран оплаты — подпись справа. */}
        <button
          onClick={onSubmit}
          disabled={!rows.length}
          className={cx(
            'w-full h-14 rounded-2xl flex items-center justify-center gap-2 text-white text-lg font-bold tracking-tight transition shadow-lg',
            rows.length
              ? 'bg-[var(--ok,#16a34a)] hover:brightness-110 shadow-emerald-500/25'
              : 'bg-surface-3 text-muted cursor-not-allowed shadow-none',
          )}
        >
          <Check size={22} />
          <span>ОПЛАТИТЬ · {money(total)}</span>
          <kbd className="ml-2 hidden md:inline text-[11px] font-semibold bg-black/20 rounded px-1.5 py-0.5">
            F9
          </kbd>
        </button>
      </div>
    </div>
  )
}

export default function NewOrder() {
  const nav = useNavigate()
  const { customers, products, priceTypes, addOrder, addCustomer, orders } = useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  // Для kit доступный остаток вычисляется по компонентам (свой stock у
  // комплекта не хранится), для остальных — обычный p.stock − резерв.
  const availOf = (p) => {
    if (p.type === 'kit') return computeKitStock(p, products)
    return (p.stock || 0) - (reserved[p.id] || 0)
  }

  const [customerId, setCustomerId] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [onCredit, setOnCredit] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [msg, setMsg] = useState('')
  const [mobileCart, setMobileCart] = useState(false) // bottom-sheet чека
  const [payOpen, setPayOpen] = useState(false) // модалка выбора способа оплаты
  const [savedAt, setSavedAt] = useState(0) // время последнего автосейва (для UI-статуса)

  // ── Автосейв корзины ─────────────────────────────────────────────────
  // На /orders/new частая ситуация: кассир пробивает 100 позиций опт-клиенту,
  // случайно закрыл вкладку / зашёл в клиента / открыл другой заказ. Без
  // автосейва — всё с нуля. Сохраняем черновик в localStorage при каждом
  // изменении и восстанавливаем при возврате.
  const DRAFT_KEY = 'sklad.newOrder.draft'
  const DRAFT_TTL_MS = 6 * 60 * 60 * 1000 // 6 часов — типичная смена
  const restoredRef = useRef(false)
  // Восстановление один раз на mount. Если черновик просрочен — игнорируем.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) { restoredRef.current = true; return }
      const d = JSON.parse(raw)
      if (!d?.at || Date.now() - d.at > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY)
        restoredRef.current = true
        return
      }
      if (d.customerId) setCustomerId(d.customerId)
      if (d.priceTypeId) setPriceTypeId(d.priceTypeId)
      if (Array.isArray(d.rows) && d.rows.length) setRows(d.rows)
      if (typeof d.discount === 'number') setDiscount(d.discount)
      if (typeof d.onCredit === 'boolean') setOnCredit(d.onCredit)
      setSavedAt(d.at)
    } catch {}
    restoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Сохранение при каждом изменении полей чека. Дебаунс 400мс, чтобы не
  // писать в localStorage на каждый keystroke qty.
  useEffect(() => {
    if (!restoredRef.current) return
    if (!rows.length && !customerId && !discount) {
      // Пустой чек — стираем черновик, чтобы «Очистить» не оставлял хвост.
      localStorage.removeItem(DRAFT_KEY)
      setSavedAt(0)
      return
    }
    const t = setTimeout(() => {
      try {
        const at = Date.now()
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          customerId, priceTypeId, rows, discount, onCredit, at,
        }))
        setSavedAt(at)
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [rows, customerId, priceTypeId, discount, onCredit])

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
              basePrice: priceFor(p, priceTypeId), // база — для показа скидки в строке
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
  // Персональная цена для строки — оптовику критично: клиент N торгуется,
  // цена меняется прямо в чеке. Сохраняем базовую (basePrice) — по ней
  // считаем скидку и показываем «зачёркнутую» когда цена ниже.
  const setPrice = (id, price) =>
    setRows((r) =>
      r.map((x) =>
        x.productId === id ? { ...x, price: Math.max(0, Number(price) || 0) } : x,
      ),
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
        if (!p) return x
        const newBase = priceFor(p, ptId)
        return { ...x, price: newBase, basePrice: newBase }
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

  // Клик по «Оплатить» открывает экран выбора способа оплаты.
  // Клавиша F9 (см. useEffect ниже) делает то же самое.
  const openPay = () => {
    if (!rows.length) return
    setPayOpen(true)
  }

  // Финальное оформление после выбора способа оплаты в PaymentModal.
  // payment: { method: 'cash'|'card'|'credit'|'mixed', cashPaid, cardPaid, change }
  const finalSubmit = (payment) => {
    const cust = customers.find((c) => c.id === customerId)
    addOrder({
      customerId: cust?.id || 'retail',
      customerName: cust?.name || 'Розничный покупатель',
      items: rows,
      subtotal,
      discount: Number(discount) || 0,
      total,
      priceTypeId,
      // Долг — теперь производная от способа оплаты (для обратной совместимости
      // с существующей логикой резервов/долгов клиента в сторе).
      onCredit: payment.method === 'credit',
      payment,
      address: cust?.city || 'Самовывоз',
      courier: 'Самовывоз',
    })
    const fresh = useStore.getState().orders[0]
    // Заказ создан — черновик больше не нужен, чтобы возврат на /orders/new
    // не восстанавливал уже проведённый чек.
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setPayOpen(false)
    setMobileCart(false)
    nav(`/orders?id=${fresh.id}`)
  }

  // Клавиатурные хоткеи кассы:
  //   F9  → открыть экран оплаты (стандарт 1С/Frontol)
  //   /   → сфокусировать SmartFind (только если фокус не в поле)
  useEffect(() => {
    const onKey = (e) => {
      if (payOpen) return // модалка сама обрабатывает Enter/Esc
      if (e.key === 'F9') {
        e.preventDefault()
        openPay()
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        document.querySelector('input[placeholder^="Поиск товара"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen, rows.length])

  const cartProps = {
    rows,
    count,
    subtotal,
    total,
    discount,
    setDiscount,
    customerId,
    customers,
    onPickCustomer: selectCustomer,
    onAddCustomer: createCustomer,
    priceTypeId,
    priceTypes,
    onChangeType: changeType,
    onSetQty: setQty,
    onSetPrice: setPrice,
    onSubmit: openPay,
    round3,
  }

  return (
    <div className="animate-fadeUp pb-24 lg:pb-0">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" icon={ArrowLeft} onClick={() => nav('/orders')} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Новый заказ</h2>
          <p className="text-sm text-muted hidden sm:block">
            Касса: ищите или сканируйте товар — он попадёт в чек.
          </p>
        </div>
        {savedAt > 0 && rows.length > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-ok-soft text-ok text-[11.5px] font-semibold"
            title={`Черновик сохранён ${new Date(savedAt).toLocaleTimeString('ru-RU')}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-ok" />
            Черновик сохранён
          </span>
        )}
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

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
        {/* На мобиле CTA-bar внизу: тап открывает bottom-sheet чека,
            там свой большой «Оплатить» откроет PaymentModal. */}
        <button
          onClick={() => setMobileCart(true)}
          disabled={!rows.length}
          className={cx(
            'h-12 px-5 rounded-2xl inline-flex items-center gap-2 text-white text-[15px] font-bold transition shrink-0',
            rows.length
              ? 'bg-[var(--ok,#16a34a)] hover:brightness-110'
              : 'bg-surface-3 text-muted cursor-not-allowed',
          )}
        >
          <Check size={18} /> Оплатить
        </button>
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

      {/* Экран выбора способа оплаты — открывается по клику «Оплатить» или F9.
          Управляет всей логикой оплаты (кроме создания заказа) внутри себя,
          а на подтверждение вызывает finalSubmit(payment). */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        total={total}
        onConfirm={finalSubmit}
      />
    </div>
  )
}

// Экран выбора способа оплаты. Крупные кнопки «Наличные / Карта / В долг /
// Смешанная». Для наличных — поле «Получено» + расчёт сдачи. Для смешанной
// — 2 поля. Enter подтверждает, Esc закрывает. Стандартный POS-flow: сумма
// на экране крупно, минимум решений от кассира. Опирается на компоненты
// Modal/Button/Input из components/ui.
function PaymentModal({ open, onClose, total, onConfirm }) {
  const [method, setMethod] = useState('cash') // cash | card | credit | mixed
  const [cashPaid, setCashPaid] = useState('')
  const [cardPaid, setCardPaid] = useState('')

  useEffect(() => {
    if (open) {
      // Сброс к дефолтам при каждом открытии.
      setMethod('cash')
      setCashPaid(String(total || ''))
      setCardPaid('')
    }
  }, [open, total])

  const cashN = Number(cashPaid) || 0
  const cardN = Number(cardPaid) || 0
  const change = method === 'cash' ? Math.max(0, cashN - total) : 0
  const mixedTotal = cashN + cardN
  const mixedShort = Math.max(0, total - mixedTotal)

  // Валидация «можно ли пробить».
  const canConfirm =
    method === 'card' ||
    method === 'credit' ||
    (method === 'cash' && cashN >= total) ||
    (method === 'mixed' && mixedTotal >= total && cashN > 0 && cardN > 0)

  const confirm = () => {
    if (!canConfirm) return
    onConfirm({
      method,
      cashPaid: method === 'cash' ? cashN : method === 'mixed' ? cashN : 0,
      cardPaid: method === 'card' ? total : method === 'mixed' ? cardN : 0,
      change,
    })
  }

  // Enter — подтвердить, Esc — закрыть. Только пока модалка открыта.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Enter' && canConfirm) {
        e.preventDefault()
        confirm()
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canConfirm, method, cashN, cardN])

  const methods = [
    { key: 'cash', label: 'Наличные', icon: '₽', color: 'ok' },
    { key: 'card', label: 'Карта', icon: '💳', color: 'info' },
    { key: 'credit', label: 'В долг', icon: '⏱', color: 'warn' },
    { key: 'mixed', label: 'Смешанная', icon: '±', color: 'brand' },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          Оплата
          <span className="text-2xl font-bold tabular-nums text-brand">{money(total)}</span>
        </span>
      }
    >
      <div className="space-y-4">
        {/* Крупные плитки способов оплаты — тач-фрэндли. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              className={cx(
                'h-24 rounded-2xl flex flex-col items-center justify-center gap-1 text-[15px] font-semibold border-2 transition',
                method === m.key
                  ? 'bg-brand-soft border-brand text-brand'
                  : 'bg-surface-2 border-line text-muted hover:text-ink',
              )}
            >
              <div className="text-3xl leading-none">{m.icon}</div>
              <div>{m.label}</div>
            </button>
          ))}
        </div>

        {/* Наличные — ввод «получено» и крупная плашка «сдача». */}
        {method === 'cash' && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <div>
              <div className="text-[12px] text-muted mb-1.5">Получено, ₽</div>
              <Input
                type="number"
                value={cashPaid}
                onChange={(e) => setCashPaid(e.target.value)}
                className="text-2xl font-bold text-right tabular-nums h-14"
                autoFocus
              />
            </div>
            {/* Быстрые суммы: точная / +100 / +500 / +1000 */}
            <div className="grid grid-cols-4 gap-2">
              {[total, total + 100, total + 500, total + 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setCashPaid(String(v))}
                  className="h-9 rounded-lg bg-surface hover:bg-surface-3 border border-line text-[13px] font-medium tabular-nums"
                >
                  {money(v)}
                </button>
              ))}
            </div>
            <div
              className={cx(
                'flex items-center justify-between p-3 rounded-xl font-semibold',
                cashN < total
                  ? 'bg-bad-soft text-bad'
                  : change > 0
                    ? 'bg-ok-soft text-ok'
                    : 'bg-surface-3 text-muted',
              )}
            >
              <span>{cashN < total ? 'Не хватает' : 'Сдача'}</span>
              <span className="text-xl tabular-nums">
                {money(cashN < total ? total - cashN : change)}
              </span>
            </div>
          </div>
        )}

        {/* Карта — просто подтверждение суммы, ввода не требуется. */}
        {method === 'card' && (
          <div className="rounded-2xl bg-info-soft text-info p-4 flex items-center justify-between">
            <span className="font-medium">К оплате картой</span>
            <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
          </div>
        )}

        {/* В долг — предупреждение и подтверждение суммы. */}
        {method === 'credit' && (
          <div className="rounded-2xl bg-warn-soft text-warn p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">В долг клиенту</span>
              <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
            </div>
            <div className="text-[12px] opacity-80">
              Сумма прибавится к балансу выбранного клиента. Розничным покупателям
              «в долг» оформить нельзя — выберите клиента в чеке.
            </div>
          </div>
        )}

        {/* Смешанная — 2 поля с автопересчётом «недостающего». */}
        {method === 'mixed' && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] text-muted mb-1.5">Наличными, ₽</div>
                <Input
                  type="number"
                  value={cashPaid}
                  onChange={(e) => setCashPaid(e.target.value)}
                  className="text-lg font-semibold text-right tabular-nums"
                  autoFocus
                />
              </div>
              <div>
                <div className="text-[12px] text-muted mb-1.5">Картой, ₽</div>
                <Input
                  type="number"
                  value={cardPaid}
                  onChange={(e) => setCardPaid(e.target.value)}
                  className="text-lg font-semibold text-right tabular-nums"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface">
              <span className="text-[13px] text-muted">Итого внесено</span>
              <span className="font-semibold tabular-nums">{money(mixedTotal)}</span>
            </div>
            {mixedShort > 0 && (
              <div className="text-[12px] text-bad text-right">
                Не хватает {money(mixedShort)}
              </div>
            )}
          </div>
        )}

        {/* Финальная CTA. Enter тоже сработает. */}
        <button
          onClick={confirm}
          disabled={!canConfirm}
          className={cx(
            'w-full h-16 rounded-2xl flex items-center justify-center gap-2 text-white text-xl font-bold transition shadow-lg',
            canConfirm
              ? 'bg-[var(--ok,#16a34a)] hover:brightness-110 shadow-emerald-500/25'
              : 'bg-surface-3 text-muted cursor-not-allowed shadow-none',
          )}
        >
          <Check size={22} />
          Пробить чек
          <kbd className="text-[11px] font-semibold bg-black/20 rounded px-1.5 py-0.5">
            Enter
          </kbd>
        </button>
      </div>
    </Modal>
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
