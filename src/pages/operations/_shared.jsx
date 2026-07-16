// Общие элементы вкладок Operations: единый поиск (текст + штрихкод +
// камера), сетка товаров, тост об успехе, список вкладок.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  TrendingDown,
  Undo2,
  ClipboardCheck,
  History,
  Search,
  Check,
  ShoppingCart,
  ArrowLeftRight,
  Truck,
  FileText,
  ShieldCheck,
  Camera,
  X,
  Package,
  Wrench,
  Hammer,
  Zap,
  Droplets,
  PaintBucket,
} from 'lucide-react'
import { Empty, cx } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { money, num } from '../../lib/format'
import { CATEGORIES, catInfo } from '../../lib/constants'
import { resolveScan } from '../../lib/barcode'

// Иконка по типу документа — используется в реестре и журнале.
export const DOC_ICON = {
  purchase: ArrowDownToLine,
  sale: ShoppingCart,
  sale_return: Undo2,
  supplier_return: Truck,
  transfer: ArrowLeftRight,
  writeoff: TrendingDown,
  inventory: ClipboardCheck,
}

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

// Табы верхней панели Operations. Порядок = порядок отрисовки.
// «Продажа» и «Закупка» стоят первыми — это самые частые операции.
export const TABS = [
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

// Поиск товара по названию/артикулу — простой dropdown-suggest.
// Оставлен для тех вкладок, где не нужен полный SmartFind (TransferTab, MoveForm).
export function ProductSearch({ onPick, placeholder = 'Найти товар по названию или артикулу…' }) {
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

// Единое поле «Поиск / штрихкод» с иконкой камеры справа. Убирает вторую
// строку с большим ScannerInput сверху страницы — весь ввод (текст /
// USB-сканер / камера) идёт в одно поле. Автосабмит по Enter: если строка
// похожа на штрихкод (8+ цифр) — идёт в onScan, иначе просто обновляет query.
// USB-сканер эмулирует клавиатуру + Enter, поэтому «просто попадает» сюда,
// если поле в фокусе.
export function SmartFind({ query, setQuery, onScan, msg, placeholder = 'Поиск товара или штрихкод…' }) {
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
          placeholder={placeholder}
          className="w-full h-11 pl-9 pr-12 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-[15px]"
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

// Плитка товара для сетки: фото/иконка, цена (или себестоимость),
// количество в корзине. Клик по пустой плитке добавляет 1 шт., по плитке
// с товаром в корзине — редактирует qty инлайн (без модалки).
export function ProductTile({ p, priceField, showStock, inCart, onAdd, onSetQty, weightedStep = 0.1 }) {
  const c = catInfo(p.category)
  const Icon = CAT_ICON[c.icon] || Package
  const step = p.weighted ? weightedStep : 1
  const price = Number(p[priceField]) || 0
  const total = inCart ? inCart.qty * price : 0

  return (
    <div
      role={inCart ? undefined : 'button'}
      onClick={() => !inCart && onAdd(p)}
      className={cx(
        'card p-2 sm:p-3 flex flex-col gap-2 transition relative',
        inCart ? 'border-brand' : 'hover:border-brand/50 cursor-pointer',
      )}
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-2 shrink-0">
        {p.image ? (
          <img src={p.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              background: `linear-gradient(135deg,
                color-mix(in srgb, ${c.color} 18%, transparent),
                color-mix(in srgb, ${c.color} 4%, transparent))`,
            }}
          >
            <Icon size={30} style={{ color: c.color, opacity: 0.55 }} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-snug line-clamp-2 min-h-[2.4em]">
          {p.name}
        </div>
        <div className="text-[11px] text-muted truncate">{p.sku}</div>
      </div>
      {inCart ? (
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(inCart.productId, Math.max(0, Math.round((inCart.qty - step) * 1000) / 1000))
            }}
            className="h-7 w-7 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            −
          </button>
          <input
            type="number"
            value={inCart.qty}
            min={p.weighted ? '0.001' : '1'}
            step={step}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetQty(inCart.productId, Math.max(0, +e.target.value))}
            className="w-12 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-center"
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(inCart.productId, Math.round((inCart.qty + step) * 1000) / 1000)
            }}
            className="h-7 w-7 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            +
          </button>
          <span className="ml-auto text-[13px] font-semibold tabular-nums">
            {money(total)}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold text-[15px] tabular-nums">
            {money(price)}
            {p.weighted && <span className="text-[10px] text-muted font-normal">/кг</span>}
          </span>
          {showStock && (
            <span className="text-[10.5px] text-muted whitespace-nowrap">
              {num(p.stock)} {p.unit}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// Сетка товаров с фильтрами по категории и общим SmartFind сверху. Общий
// компонент для SaleTab, ReceiveTab и других форм документов, где нужен
// быстрый выбор товара из каталога.
// Проп priceField: 'price' для продажи, 'cost' для закупки.
export function ProductPickerGrid({
  query,
  setQuery,
  onScan,
  msg,
  cat,
  setCat,
  rowsById,
  onAdd,
  onSetQty,
  priceField = 'price',
  showStock = true,
  placeholder,
}) {
  const products = useStore((s) => s.products)
  const list = useMemo(() => {
    const s = query.trim().toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ =
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags?.some((t) => t.includes(s))
      return okC && okQ
    })
  }, [products, query, cat])

  return (
    <div className="space-y-3 min-w-0">
      <SmartFind
        query={query}
        setQuery={setQuery}
        onScan={onScan}
        msg={msg}
        placeholder={placeholder}
      />
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        <Chip active={cat === 'all'} onClick={() => setCat('all')}>Все</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
            {c.key}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {list.map((p) => (
          <ProductTile
            key={p.id}
            p={p}
            priceField={priceField}
            showStock={showStock}
            inCart={rowsById[p.id]}
            onAdd={onAdd}
            onSetQty={onSetQty}
          />
        ))}
      </div>
      {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}
    </div>
  )
}

// Универсальный chip для категорий. Не путать с Badge из ui.jsx (там —
// метка статуса), у Chip есть active-состояние.
export function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'px-3 h-9 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
        active ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

// Хелпер: превратить barcode/EAN в товар и добавить в корзину.
export function useScanResolver(products, add, setMsg) {
  return (code) => {
    const r = resolveScan(code, products)
    if (!r) {
      setMsg(`Штрихкод «${code}» не найден в каталоге`)
      return
    }
    add(r.product, r.weighed ? r.weightKg : 1)
    if (r.weighed) setMsg(`Весовой: ${r.product.name} — ${r.weightKg} кг`)
  }
}

export function Toast({ children }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-ok-soft text-ok text-sm font-medium animate-fadeUp">
      <Check size={16} /> {children}
    </div>
  )
}
