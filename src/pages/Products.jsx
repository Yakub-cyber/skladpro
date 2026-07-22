import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  Plus,
  Wrench,
  Hammer,
  Zap,
  Droplets,
  PaintBucket,
  Package,
  MapPin,
  PackagePlus,
  Pencil,
  FileUp,
  Tags,
  Printer,
  Download,
  Check,
  TriangleAlert,
  Scale,
  ShieldCheck,
  Tag,
  ImagePlus,
  X,
  Barcode,
  RefreshCw,
  ScanLine,
  Camera,
  SlidersHorizontal,
} from 'lucide-react'
import { compressImage } from '../lib/image'
import {
  Card,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
  Empty,
  cx,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { CATEGORIES, catInfo, PRODUCT_TYPES, isService, isKit, isRealProduct } from '../lib/constants'
import { computeKitStock } from '../lib/kit'
import { CELLS } from '../store/seed'
import { printLabels, printPriceTags, barcodeSVG } from '../lib/labels'
import {
  parsePriceTable,
  SAMPLE_TEMPLATE,
  readImportFile,
  parseTextToTable,
  autoMap,
  applyMapping,
  IMPORT_FIELDS,
} from '../lib/importPrice'
import { downloadCsv } from '../lib/export'
import { reservedByProduct } from '../lib/orders'
import { generateEan13 } from '../lib/barcode'
import ScannerInput from '../components/ScannerInput'
import { useConfirm } from '../components/Confirm'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

const stockTone = (p) =>
  p.stock <= p.minStock ? 'bad' : p.stock <= p.minStock * 1.5 ? 'warn' : 'ok'

// Пустой набор фильтров — по нему сбрасываем панель к дефолту.
const EMPTY_FILTERS = {
  priceMin: '',
  priceMax: '',
  stockMin: '',
  stockMax: '',
  stockStatus: 'any', // any | low (ниже min) | out (0) | in
  weighted: 'any',
  marked: 'any',
}

export default function Products() {
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [cat, setCat] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all') // all | product | service | kit
  const [edit, setEdit] = useState(null) // product | 'new' | null
  const [showImport, setShowImport] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Число активных фильтров — для бейджа рядом с кнопкой «Фильтр».
  const activeFiltersCount = useMemo(() => {
    let n = 0
    if (filters.priceMin !== '') n++
    if (filters.priceMax !== '') n++
    if (filters.stockMin !== '') n++
    if (filters.stockMax !== '') n++
    if (filters.stockStatus !== 'any') n++
    if (filters.weighted !== 'any') n++
    if (filters.marked !== 'any') n++
    return n
  }, [filters])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const numOr = (v, fallback) => (v === '' || v == null ? fallback : Number(v))
    return products.filter((p) => {
      // Фильтр по типу позиции (Товар / Услуга / Комплект).
      // Дефолтное значение p.type — 'product', учитываем legacy без type.
      const t = p.type || 'product'
      if (typeFilter !== 'all' && t !== typeFilter) return false
      const okC = cat === 'all' || p.category === cat
      const okQ =
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags.some((tag) => tag.includes(s))
      if (!okC || !okQ) return false
      // Диапазон цены (розничной).
      const price = Number(p.price) || 0
      if (price < numOr(filters.priceMin, -Infinity)) return false
      if (price > numOr(filters.priceMax, Infinity)) return false
      // Диапазон остатка.
      const stock = Number(p.stock) || 0
      if (stock < numOr(filters.stockMin, -Infinity)) return false
      if (stock > numOr(filters.stockMax, Infinity)) return false
      // Статус остатка.
      const min = Number(p.minStock) || 0
      if (filters.stockStatus === 'low' && stock > min) return false
      if (filters.stockStatus === 'out' && stock > 0) return false
      if (filters.stockStatus === 'in' && stock <= 0) return false
      // Признаки.
      if (filters.weighted === 'yes' && !p.weighted) return false
      if (filters.weighted === 'no' && p.weighted) return false
      if (filters.marked === 'yes' && !p.marked) return false
      if (filters.marked === 'no' && p.marked) return false
      return true
    })
  }, [products, q, cat, filters, typeFilter])

  // Пагинация: на демо-30 SKU незаметно, на реальном оптовом каталоге
  // (тысячи позиций) полный рендер таблицы тормозит. Показываем окно
  // фиксированного размера, кнопкой добираем ещё. Сброс при смене
  // фильтра/поиска — чтобы пользователь видел свежий срез, а не «висящий»
  // конец прошлого фильтра.
  const PAGE_SIZE = 100
  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [q, cat, filters, typeFilter])
  const shown = list.slice(0, visible)

  const totalValue = products.reduce((a, p) => a + p.stock * p.cost, 0)

  // Экспорт видимого списка (с учётом поиска и фильтра категории) в CSV/Excel
  const exportCsv = () =>
    downloadCsv(`Товары-${new Date().toISOString().slice(0, 10)}`, list, [
      { key: 'sku', label: 'Артикул' },
      { key: 'name', label: 'Название' },
      { key: 'category', label: 'Категория' },
      { key: 'unit', label: 'Ед.' },
      { key: 'stock', label: 'Остаток' },
      { key: 'minStock', label: 'Мин. остаток' },
      { key: 'cost', label: 'Себестоимость' },
      { key: 'stock', label: 'Сумма в закупке', map: (_, p) => Math.round(p.stock * p.cost) },
      { key: 'cell', label: 'Ячейка' },
    ])

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Товары</h2>
          <p className="text-sm text-muted">
            {products.length} SKU · склад на {money(totalValue)} в закупке
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="soft" icon={Tags} onClick={() => setShowLabels(true)}>
            <span className="hidden sm:inline">Этикетки</span>
          </Button>
          <Button variant="soft" icon={Download} onClick={exportCsv} disabled={!list.length}>
            <span className="hidden sm:inline">Экспорт</span>
          </Button>
          <Button variant="soft" icon={FileUp} onClick={() => setShowImport(true)}>
            <span className="hidden sm:inline">Импорт</span>
          </Button>
          <Button icon={Plus} onClick={() => setEdit('new')}>
            <span className="hidden sm:inline">Добавить товар</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию, артикулу, тегу…"
            className="pl-9"
          />
        </div>
        {/* Кнопка фильтров: раскрывает панель с полями (цена, остаток,
            статус), число активных фильтров — на бейдже. Клик по «Сброс»
            внутри панели быстро возвращает к «нет фильтров». */}
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={cx(
            'h-10 px-3 rounded-xl inline-flex items-center gap-2 text-sm font-medium border transition shrink-0',
            filtersOpen || activeFiltersCount
              ? 'bg-brand text-brand-ink border-brand'
              : 'bg-surface-2 border-line text-muted hover:text-ink',
          )}
        >
          <SlidersHorizontal size={16} />
          <span className="hidden sm:inline">Фильтр</span>
          {activeFiltersCount > 0 && (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-white/25 text-[11px] font-semibold grid place-items-center">
              {activeFiltersCount}
            </span>
          )}
        </button>
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

      {/* Чипы фильтра по типу позиции (Товар / Услуга / Комплект).
          Считаем количество каждого — цифра рядом с чипом. */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4 -mx-1 px-1">
        <TypeChip
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
          count={products.length}
        >
          Все
        </TypeChip>
        {PRODUCT_TYPES.map((t) => {
          const n = products.filter((p) => (p.type || 'product') === t.key).length
          return (
            <TypeChip
              key={t.key}
              active={typeFilter === t.key}
              onClick={() => setTypeFilter(t.key)}
              count={n}
            >
              {t.short}
            </TypeChip>
          )
        })}
      </div>

      {/* Раскрывающаяся панель фильтров */}
      {filtersOpen && (
        <FiltersPanel
          filters={filters}
          setFilters={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
          activeCount={activeFiltersCount}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* Мобильные карточки — без внутреннего горизонтального скролла таблицы.
          Крупное фото/иконка слева, компактная сводка справа. */}
      <div className="lg:hidden space-y-2">
        {shown.map((p) => {
          const c = catInfo(p.category)
          const Icon = CAT_ICON[c.icon] || Package
          return (
            <button
              key={p.id}
              onClick={() => setEdit(p)}
              className="w-full card p-3 flex items-center gap-3 text-left hover:border-brand/40 transition"
            >
              {p.image ? (
                <img
                  src={p.image}
                  alt=""
                  className="h-14 w-14 rounded-xl object-cover shrink-0"
                />
              ) : (
                <div
                  className="h-14 w-14 rounded-xl grid place-items-center shrink-0"
                  style={{
                    background: `color-mix(in srgb, ${c.color} 16%, transparent)`,
                    color: c.color,
                  }}
                >
                  <Icon size={22} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[14px] leading-snug truncate flex items-center gap-1.5">
                  {p.name}
                  {isService(p) && (
                    <Badge tone="info" className="shrink-0 text-[10px]">услуга</Badge>
                  )}
                  {isKit(p) && (
                    <Badge tone="brand" className="shrink-0 text-[10px]">комплект</Badge>
                  )}
                  {p.weighted && <Scale size={12} className="text-info shrink-0" />}
                  {p.marked && <ShieldCheck size={12} className="text-ok shrink-0" />}
                </div>
                <div className="text-[12px] text-muted truncate mt-0.5">
                  {p.sku}
                  {' · '}
                  <span style={{ color: c.color }}>{p.category}</span>
                  {!isService(p) && !isKit(p) && (
                    <>
                      {' · '}
                      <MapPin size={11} className="inline -mt-0.5" /> {p.cell}
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="font-semibold text-[15px] tabular-nums">{money(p.price)}</span>
                  {isRealProduct(p) ? (
                    <Badge tone={stockTone(p)}>
                      {num(p.stock)} {p.unit}
                    </Badge>
                  ) : isKit(p) ? (
                    // Комплект: остаток = сколько наборов можно собрать из
                    // текущих остатков компонентов. Считается на лету.
                    <Badge tone="brand">
                      {num(computeKitStock(p, products))} {p.unit}
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted">без остатка</span>
                  )}
                </div>
                {isRealProduct(p) && reserved[p.id] > 0 && (
                  <div className="text-[11px] text-muted mt-0.5 tabular-nums">
                    резерв {num(reserved[p.id])} · дост. {num(p.stock - reserved[p.id])}
                  </div>
                )}
              </div>
            </button>
          )
        })}
        {list.length === 0 && (
          <Empty icon={Package} title="Ничего не найдено" text="Измените запрос или фильтр." />
        )}
      </div>

      {/* Десктопная таблица */}
      <Card className="overflow-hidden hidden lg:block">
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line bg-surface-2/40">
                <th className="font-medium py-3 px-4">Товар</th>
                <th className="font-medium py-3 px-3 hidden xl:table-cell">Категория</th>
                <th className="font-medium py-3 px-3 hidden xl:table-cell">Ячейка</th>
                <th className="font-medium py-3 px-3 text-right">Себест.</th>
                <th className="font-medium py-3 px-3 text-right">Цена</th>
                <th className="font-medium py-3 px-3 text-right">Мин.</th>
                <th className="font-medium py-3 px-3 text-right">Резерв</th>
                <th className="font-medium py-3 px-3 text-right">Доступно</th>
                <th className="font-medium py-3 px-4 text-right">Остаток</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((p) => {
                const c = catInfo(p.category)
                const Icon = CAT_ICON[c.icon] || Package
                return (
                  <tr
                    key={p.id}
                    className="hover:bg-surface-2/50 transition cursor-pointer"
                    onClick={() => setEdit(p)}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        {p.image ? (
                          <img
                            src={p.image}
                            alt=""
                            className="h-9 w-9 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div
                            className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
                            style={{
                              background: `color-mix(in srgb, ${c.color} 16%, transparent)`,
                              color: c.color,
                            }}
                          >
                            <Icon size={17} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {p.name}
                            {p.weighted && (
                              <Scale size={13} className="text-info shrink-0" />
                            )}
                            {p.marked && (
                              <ShieldCheck size={13} className="text-ok shrink-0" />
                            )}
                          </div>
                          <div className="text-[12px] text-muted">{p.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden xl:table-cell">
                      <span className="text-[13px]" style={{ color: c.color }}>
                        {p.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 hidden xl:table-cell">
                      <Badge tone="muted">
                        <MapPin size={11} /> {p.cell}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                      {money(p.cost)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {money(p.price)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                      {num(p.minStock || 0)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {reserved[p.id] > 0 ? (
                        <span className="text-warn">{num(reserved[p.id])}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {num(Math.max(0, p.stock - (reserved[p.id] || 0)))}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {isKit(p) ? (
                        <Badge tone="brand">
                          {num(computeKitStock(p, products))} {p.unit}
                        </Badge>
                      ) : (
                        <Badge tone={stockTone(p)}>
                          {num(p.stock)} {p.unit}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      <Pencil size={15} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {list.length === 0 && (
            <Empty icon={Package} title="Ничего не найдено" text="Измените запрос или фильтр." />
          )}
        </div>
      </Card>

      {/* Пагинация — общая для мобильных карточек и десктопной таблицы. */}
      {visible < list.length && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[12px] text-muted">
            Показано {shown.length} из {list.length}
          </div>
          <Button variant="soft" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Показать ещё {Math.min(PAGE_SIZE, list.length - visible)}
          </Button>
        </div>
      )}

      {edit && (
        <ProductModal
          product={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
        />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showLabels && <LabelsModal products={list} onClose={() => setShowLabels(false)} />}
    </div>
  )
}

function ImageField({ value, onChange }) {
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const handleFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return
    setBusy(true)
    try {
      const dataUrl = await compressImage(file)
      onChange(dataUrl)
    } catch {
      /* игнор — просто не заменим */
    }
    setBusy(false)
  }
  const onFile = async (e) => {
    await handleFile(e.target.files?.[0])
    e.target.value = ''
  }
  const onDrop = async (e) => {
    e.preventDefault()
    setDrag(false)
    await handleFile(e.dataTransfer.files?.[0])
  }
  return (
    <div>
      {/* Крупное превью на всю ширину — на мобиле удобнее видеть, что выбрал.
          Ниже — две кнопки: снять с камеры (мобиль) и выбрать файл. */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          'relative aspect-square max-w-[240px] mx-auto sm:mx-0 rounded-xl border-2 border-dashed overflow-hidden grid place-items-center transition',
          drag ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2',
        )}
      >
        {value ? (
          <>
            <img src={value} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange('')}
              title="Убрать фото"
              className="absolute top-1.5 right-1.5 h-8 w-8 rounded-full bg-black/60 text-white grid place-items-center hover:bg-bad"
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <div className="text-center text-muted px-3">
            <ImagePlus size={32} className="mx-auto mb-1.5 opacity-60" />
            <div className="text-[12px]">
              {busy ? 'Обработка…' : 'Перетащите фото или выберите'}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        <label className="flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm cursor-pointer">
          <ImagePlus size={15} /> {value ? 'Заменить' : 'Загрузить'}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
        {/* Мобильная кнопка «камера» — открывает системную камеру напрямую.
            На десктопе тоже работает как обычный file picker с фильтром. */}
        <label className="flex-1 inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm cursor-pointer">
          <Camera size={15} /> Снять
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            className="hidden"
          />
        </label>
      </div>
    </div>
  )
}

function BarcodeField({ value, onChange }) {
  const [scan, setScan] = useState(false)
  return (
    <div>
      <span className="block text-[13px] font-medium text-muted mb-1.5">Штрихкод</span>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Barcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="EAN-13 / Code128…"
            className="pl-9"
          />
        </div>
        <Button variant="soft" icon={RefreshCw} onClick={() => onChange(generateEan13())}>
          Сгенерировать
        </Button>
        <Button variant={scan ? 'primary' : 'soft'} icon={ScanLine} onClick={() => setScan((v) => !v)}>
          Скан
        </Button>
      </div>
      {value && (
        <div
          className="mt-2 p-2.5 rounded-xl bg-white inline-block"
          dangerouslySetInnerHTML={{ __html: barcodeSVG(value) }}
        />
      )}
      {scan && (
        <div className="mt-2">
          <ScannerInput
            placeholder="Считайте штрихкод сканером или камерой…"
            onScan={(code) => {
              onChange(code)
              setScan(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function TypeTab2({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-medium transition border',
        active ? 'bg-brand-soft border-brand/30 text-brand' : 'bg-surface-2 border-line text-muted hover:text-ink',
      )}
    >
      <Icon size={16} /> {children}
    </button>
  )
}

function CheckCard({ checked, onChange, title, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        'flex items-start gap-2.5 p-3 rounded-xl border text-left transition',
        checked ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/40',
      )}
    >
      <span
        className={cx(
          'h-5 w-5 rounded-md grid place-items-center shrink-0 mt-0.5 border',
          checked ? 'bg-brand border-brand text-brand-ink' : 'border-line',
        )}
      >
        {checked && <Check size={13} />}
      </span>
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  )
}

// Панель фильтров: раскрывающийся блок с полями цены/остатка/статуса.
// Не модалка, а inline-панель под поисковой строкой — так пользователь
// сразу видит эффект фильтров на таблице.
function FiltersPanel({ filters, setFilters, onReset, activeCount, onClose }) {
  const set = (k, v) => setFilters((s) => ({ ...s, [k]: v }))
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 mb-4 animate-fadeUp">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal size={16} className="text-brand" />
        <h4 className="font-semibold text-sm">Фильтры</h4>
        <span className="text-[12px] text-muted">
          {activeCount ? `активных: ${activeCount}` : 'без фильтров'}
        </span>
        <div className="ml-auto flex gap-1">
          {activeCount > 0 && (
            <button
              onClick={onReset}
              className="text-[12px] px-2 h-8 rounded-lg text-muted hover:text-ink hover:bg-surface-2"
            >
              Сброс
            </button>
          )}
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-muted hover:text-ink hover:bg-surface-2 grid place-items-center"
            title="Скрыть"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <RangeField
          label="Цена, ₽"
          min={filters.priceMin}
          max={filters.priceMax}
          onMin={(v) => set('priceMin', v)}
          onMax={(v) => set('priceMax', v)}
        />
        <RangeField
          label="Остаток"
          min={filters.stockMin}
          max={filters.stockMax}
          onMin={(v) => set('stockMin', v)}
          onMax={(v) => set('stockMax', v)}
        />
        <SelectField
          label="Статус остатка"
          value={filters.stockStatus}
          onChange={(v) => set('stockStatus', v)}
          options={[
            { value: 'any', label: 'Любой' },
            { value: 'low', label: 'Ниже минимума' },
            { value: 'out', label: 'Закончился' },
            { value: 'in', label: 'В наличии' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Весовой"
            value={filters.weighted}
            onChange={(v) => set('weighted', v)}
            options={[
              { value: 'any', label: 'Любой' },
              { value: 'yes', label: 'Да' },
              { value: 'no', label: 'Нет' },
            ]}
          />
          <SelectField
            label="Маркировка"
            value={filters.marked}
            onChange={(v) => set('marked', v)}
            options={[
              { value: 'any', label: 'Любой' },
              { value: 'yes', label: 'Да' },
              { value: 'no', label: 'Нет' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function RangeField({ label, min, max, onMin, onMax }) {
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={min}
          onChange={(e) => onMin(e.target.value)}
          placeholder="от"
          className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand"
        />
        <span className="text-muted text-xs">–</span>
        <input
          type="number"
          value={max}
          onChange={(e) => onMax(e.target.value)}
          placeholder="до"
          className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand"
        />
      </div>
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// Крупный чип с числом — для фильтра по типу позиции (Товар/Услуга/Комплект).
// Отличается от обычного Chip брендовой обводкой и цифрой справа.
function TypeChip({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-[13px] font-medium whitespace-nowrap transition border',
        active
          ? 'bg-brand text-brand-ink border-brand'
          : 'bg-surface border-line text-muted hover:text-ink',
      )}
    >
      <span>{children}</span>
      <span
        className={cx(
          'text-[11px] px-1.5 h-5 min-w-5 grid place-items-center rounded-md tabular-nums',
          active ? 'bg-white/25' : 'bg-surface-2 text-ink',
        )}
      >
        {count}
      </span>
    </button>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'px-3 h-9 rounded-lg text-[13px] font-medium whitespace-nowrap transition',
        active ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function ProductModal({ product, onClose }) {
  const { addProduct, updateProduct, adjustStock, removeProduct, priceTypes, products: allProducts } = useStore()
  const confirm = useConfirm()
  const handleRemove = async () => {
    const ok = await confirm({
      title: `Удалить «${product.name}»?`,
      body: 'Товар пропадёт из каталога. История продаж и остатки в закрытых документах сохранятся.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) {
      removeProduct(product.id)
      onClose()
    }
  }
  const isNew = !product
  const [f, setF] = useState(
    product || {
      type: 'product',
      name: '',
      sku: '',
      category: 'Крепёж',
      unit: 'шт',
      price: 0,
      cost: 0,
      stock: 0,
      minStock: 0,
      cell: CELLS[0].id,
      tags: [],
      prices: {},
      components: [],
    },
  )
  const type = f.type || 'product'
  const isServiceForm = type === 'service'
  const isKitForm = type === 'kit'
  const [receive, setReceive] = useState('')
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const priceOf = (tid) => f.prices?.[tid] ?? f.price ?? 0
  const setPrice = (tid, v) =>
    setF((s) => ({ ...s, prices: { ...s.prices, [tid]: Number(v) || 0 } }))

  const save = () => {
    // базовая цена = цена категории по умолчанию (для совместимости отображения)
    const price = priceOf(defType)
    const data = { ...f, price }
    if (isNew) addProduct(data)
    else updateProduct(product.id, data)
    onClose()
  }
  const doReceive = () => {
    const n = parseInt(receive)
    if (n > 0) {
      adjustStock(product.id, n)
      onClose()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Новый товар' : product.name}
      footer={
        <>
          {!isNew && (
            <Button
              variant="ghost"
              className="text-bad mr-auto"
              onClick={handleRemove}
            >
              Удалить
            </Button>
          )}
          {!isNew && (
            <Button
              variant="soft"
              icon={Tags}
              onClick={() => printLabels([{ p: product, qty: 1 }])}
            >
              Этикетка
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save}>Сохранить</Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Тип позиции: Товар / Услуга / Комплект. Меняет форму: скрывает
            штрихкод/остаток/ячейку для услуги, показывает состав для kit. */}
        <div>
          <span className="block text-[13px] font-medium text-muted mb-2">Тип позиции</span>
          <div className="grid grid-cols-3 gap-2">
            {PRODUCT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => set('type', t.key)}
                className={cx(
                  'h-10 rounded-xl text-[13px] font-medium border transition',
                  type === t.key
                    ? 'bg-brand text-brand-ink border-brand'
                    : 'bg-surface-2 border-line text-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <ImageField value={f.image} onChange={(v) => set('image', v)} />
        {!isNew && !isServiceForm && !isKitForm && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-surface-2">
            <PackagePlus size={18} className="text-brand" />
            <span className="text-sm text-muted flex-1">Оприходовать поступление</span>
            <input
              type="number"
              min="1"
              value={receive}
              onChange={(e) => setReceive(e.target.value)}
              placeholder="+ кол-во"
              className="w-24 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
            />
            <Button size="sm" onClick={doReceive} disabled={!receive}>
              Принять
            </Button>
          </div>
        )}
        <Field label="Наименование">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Артикул">
            <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} />
          </Field>
          <Field label="Категория">
            <Select value={f.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.key}>{c.key}</option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Штрихкод — только для товаров (у услуги/комплекта его нет). */}
        {!isServiceForm && !isKitForm && (
          <BarcodeField value={f.barcode} onChange={(v) => set('barcode', v)} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ед. изм.">
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          </Field>
          {/* Себестоимость: у услуги обычно 0/оценка, у комплекта — сумма
              cost составляющих (посчитается при проведении FIFO). Оставляем
              поле для ручного ориентира. */}
          <Field label={isServiceForm ? 'Себестоимость, ₽' : 'Закупка, ₽'}>
            <Input
              type="number"
              value={f.cost}
              onChange={(e) => set('cost', +e.target.value)}
            />
          </Field>
        </div>

        {/* Редактор состава комплекта — только для type='kit'. Обычный
            товар и услуга состав не имеют. Комплект = «купить пакетом
            выгоднее»: его цена и остаток вычисляются из компонентов
            (см. lib/kit.js), а продажа списывает компоненты по FIFO. */}
        {isKitForm && (
          <KitComponentsEditor
            components={f.components || []}
            onChange={(components) => set('components', components)}
            allProducts={allProducts}
            currentId={product?.id}
            onFillPriceFromComponents={(sum) => {
              set('price', sum)
              // синхронизируем и категорийные цены — базой
              const nextPrices = {}
              for (const t of priceTypes) nextPrices[t.id] = Math.round(sum * (t.factor || 1))
              set('prices', nextPrices)
            }}
            priceTypes={priceTypes}
          />
        )}

        <div>
          <span className="block text-[13px] font-medium text-muted mb-2">
            Цены по категориям
          </span>
          <div className="space-y-2">
            {priceTypes.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: t.color }}
                />
                <span className="text-[13px] flex-1 truncate">
                  {t.name}
                  {t.default && <span className="text-muted"> · база</span>}
                </span>
                <div className="relative w-32">
                  <Input
                    type="number"
                    value={priceOf(t.id)}
                    onChange={(e) => setPrice(t.id, e.target.value)}
                    className="text-right pr-7"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">
                    ₽
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Остаток / минимум / ячейка — только для товара.
            У услуги и комплекта нет складского остатка (комплект берётся
            из составляющих на лету). */}
        {!isServiceForm && !isKitForm && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Остаток">
              <Input
                type="number"
                value={f.stock}
                onChange={(e) => set('stock', +e.target.value)}
                disabled={!isNew}
              />
            </Field>
            <Field label="Минимум">
              <Input
                type="number"
                value={f.minStock}
                onChange={(e) => set('minStock', +e.target.value)}
              />
            </Field>
            <Field label="Ячейка">
              <Select value={f.cell} onChange={(e) => set('cell', e.target.value)}>
                {CELLS.map((c) => (
                  <option key={c.id}>{c.id}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {/* Признаки «весовой / маркировка» — только для физического товара. */}
        {!isServiceForm && !isKitForm && (
          <div className="pt-1 space-y-2">
            <span className="block text-[13px] font-medium text-muted">Признаки</span>
            <div className="grid sm:grid-cols-2 gap-2">
              <CheckCard
                checked={!!f.weighted}
                onChange={(v) => set('weighted', v)}
                title="Весовой"
                hint="Продаётся на вес (кг), весовой штрихкод"
              />
              <CheckCard
                checked={!!f.marked}
                onChange={(v) => set('marked', v)}
                title="Маркировка «Честный знак»"
                hint="Учёт кодов маркировки (КМ)"
              />
            </div>
            {f.weighted && (
              <Field label="PLU (код для весов)" hint="2–5 цифр, печатается на весах магазина">
                <Input
                  value={f.plu || ''}
                  onChange={(e) => set('plu', e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="21"
                  inputMode="numeric"
                />
              </Field>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// Редактор состава комплекта — список товаров с qty × шт. Кнопка «сумма
// составляющих» подставляет цену комплекта как сумму розничных цен
// компонентов (для ориентира; ручная цена задаётся отдельно, ниже она
// же). Комплект не хранит собственный остаток: при продаже списываются
// компоненты, а доступное количество наборов = min(component.stock /
// component.qty). См. lib/kit.js и lib/posting.js expandItem().
function KitComponentsEditor({
  components,
  onChange,
  allProducts,
  currentId,
  onFillPriceFromComponents,
}) {
  const [q, setQ] = useState('')
  // Кандидаты для состава — только обычные товары (не услуги, не другой
  // комплект, не сам этот комплект).
  const candidates = allProducts
    .filter((p) => p.id !== currentId && (p.type || 'product') === 'product')
    .filter((p) => {
      const s = q.trim().toLowerCase()
      return !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
    })
    .slice(0, 6)

  const componentPriceTotal = components.reduce((s, c) => {
    const p = allProducts.find((x) => x.id === c.productId)
    return s + (Number(p?.price) || 0) * (Number(c.qty) || 0)
  }, 0)

  const add = (p) => {
    if (components.find((c) => c.productId === p.id)) return
    onChange([...components, { productId: p.id, qty: 1 }])
    setQ('')
  }
  const setQty = (id, qty) =>
    onChange(
      qty <= 0
        ? components.filter((c) => c.productId !== id)
        : components.map((c) => (c.productId === id ? { ...c, qty } : c)),
    )

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium">Состав комплекта</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-muted">
            Розница: <b className="text-ink tabular-nums">{money(componentPriceTotal)}</b>
          </span>
          <button
            type="button"
            onClick={() => onFillPriceFromComponents?.(componentPriceTotal)}
            className="text-[12px] px-2 h-7 rounded-lg bg-surface hover:bg-surface-2 border border-line whitespace-nowrap"
            title="Установить цену комплекта = сумма розничных цен"
          >
            Взять как цену
          </button>
        </div>
      </div>

      {components.length > 0 ? (
        <div className="space-y-1.5">
          {components.map((c) => {
            const p = allProducts.find((x) => x.id === c.productId)
            if (!p) {
              return (
                <div key={c.productId} className="p-2 rounded-lg bg-surface border border-line text-[12px] text-bad">
                  Товар не найден: {c.productId}{' '}
                  <button onClick={() => setQty(c.productId, 0)} className="ml-1 underline">
                    удалить
                  </button>
                </div>
              )
            }
            // Наборов «можно собрать» из этого компонента при текущей qty.
            const perKit = Number(c.qty) || 0
            const maxKits = perKit > 0 ? Math.floor((Number(p.stock) || 0) / perKit) : 0
            return (
              <div key={c.productId} className="flex items-center gap-2 p-2 rounded-lg bg-surface">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-muted">
                    {p.sku} · {money(p.price)}/{p.unit} · ост. {num(p.stock)} → на {maxKits} наб.
                  </div>
                </div>
                <input
                  type="number"
                  min="0.001"
                  step="1"
                  value={c.qty}
                  onChange={(e) => setQty(c.productId, +e.target.value)}
                  className="w-20 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-center tabular-nums"
                />
                <span className="text-[12px] text-muted w-8">{p.unit}</span>
                <button
                  onClick={() => setQty(c.productId, 0)}
                  className="text-muted hover:text-bad"
                  title="Убрать"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-[12px] text-muted italic">
          Добавьте товары в состав комплекта.
        </div>
      )}

      {/* Добавление товара в состав */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Найти товар для добавления в комплект…"
          className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-line text-[13px] outline-none focus:border-brand"
        />
        {q && candidates.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 card p-1 max-h-56 overflow-y-auto">
            {candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="w-full flex items-center justify-between gap-2 px-2 h-9 rounded-md hover:bg-surface-2 text-left text-[13px]"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-muted text-[11px] shrink-0">
                  {p.sku} · {money(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Импорт прайса из Excel/CSV ─────────────────────────────────────────────
// Импорт-мастер в стиле CloudShop: 3 шага (файл → мапинг колонок → превью).
// Понимает .xlsx / .xls / .csv / .tsv + вставку таблицы из буфера. На каждом
// шаге видна прогресс-плашка сверху. По совпадению SKU строка помечается
// как «обновить», новая — как «добавить». Ошибки валидации (нет SKU / нет
// названия) считаются и подсвечиваются красным.
function ImportModal({ onClose }) {
  const { products, updateProduct, addProduct } = useStore()
  const [step, setStep] = useState(1) // 1 = файл, 2 = мапинг, 3 = превью
  const [table, setTable] = useState(null) // { headers, rows }
  const [mapping, setMapping] = useState({}) // { fieldKey: colIdx }
  const [pastedText, setPastedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)

  const acceptFile = async (file) => {
    setErr('')
    setBusy(true)
    try {
      const tbl = await readImportFile(file)
      if (!tbl.headers.length) throw new Error('Файл пуст или не удалось прочитать таблицу')
      setTable(tbl)
      setMapping(autoMap(tbl.headers))
      setStep(2)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const acceptText = () => {
    setErr('')
    const t = pastedText.trim()
    if (!t) return setErr('Вставьте данные из Excel')
    const tbl = parseTextToTable(t)
    if (!tbl.headers.length) return setErr('Не удалось разобрать таблицу — проверьте формат')
    setTable(tbl)
    setMapping(autoMap(tbl.headers))
    setStep(2)
  }

  const rowsPreview = useMemo(() => {
    if (!table) return []
    return applyMapping(table, mapping, products)
  }, [table, mapping, products])

  const invalidRows = rowsPreview.filter((r) => !r.sku || !r.name)
  const updCount = rowsPreview.filter((r) => r._action === 'update').length
  const newCount = rowsPreview.filter((r) => r._action === 'new').length

  const apply = () => {
    let n = 0
    for (const r of rowsPreview) {
      if (!r.sku || !r.name) continue
      if (r._action === 'update' && r._existing) {
        const patch = {}
        ;['name', 'category', 'unit', 'price', 'cost', 'minStock', 'cell', 'barcode'].forEach((k) => {
          if (r[k] != null && r[k] !== '') patch[k] = r[k]
        })
        if (r.stock != null && r.stock !== '') patch.stock = r.stock
        updateProduct(r._existing.id, patch)
      } else {
        addProduct({
          sku: r.sku,
          name: r.name,
          category: r.category || 'Расходники',
          unit: r.unit || 'шт',
          price: r.price || 0,
          cost: r.cost || 0,
          minStock: r.minStock || 0,
          cell: r.cell || CELLS[0].id,
          stock: r.stock || 0,
          barcode: r.barcode || '',
        })
      }
      n++
    }
    setDone(n)
    setTimeout(onClose, 1500)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + SAMPLE_TEMPLATE.replace(/\t/g, ';')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shablon-praysa.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Импорт товаров"
      wide
      footer={
        <>
          <Button variant="ghost" icon={Download} onClick={downloadTemplate} className="mr-auto">
            Шаблон
          </Button>
          {step > 1 && !done && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!rowsPreview.length}>
              Далее
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={apply}
              disabled={!rowsPreview.length || done > 0 || invalidRows.length === rowsPreview.length}
              icon={Check}
            >
              {done ? `Готово: ${done}` : `Импортировать (${rowsPreview.length - invalidRows.length})`}
            </Button>
          )}
        </>
      }
    >
      <ImportSteps step={step} />
      {err && <div className="mb-3 text-[13px] text-bad">{err}</div>}

      {step === 1 && (
        <ImportStepFile
          onFile={acceptFile}
          pastedText={pastedText}
          setPastedText={setPastedText}
          onPasteContinue={acceptText}
          busy={busy}
        />
      )}
      {step === 2 && table && (
        <ImportStepMapping
          table={table}
          mapping={mapping}
          setMapping={setMapping}
        />
      )}
      {step === 3 && table && (
        <ImportStepPreview
          rows={rowsPreview}
          updCount={updCount}
          newCount={newCount}
          invalidRows={invalidRows}
        />
      )}
    </Modal>
  )
}

function ImportSteps({ step }) {
  const items = [
    { n: 1, label: 'Файл' },
    { n: 2, label: 'Колонки' },
    { n: 3, label: 'Превью' },
  ]
  return (
    <div className="flex items-center gap-2 mb-4">
      {items.map((it, i) => (
        <div key={it.n} className="flex items-center gap-2 flex-1">
          <div
            className={cx(
              'h-7 w-7 rounded-full grid place-items-center text-[12px] font-semibold shrink-0',
              step > it.n
                ? 'bg-ok text-white'
                : step === it.n
                  ? 'bg-brand text-brand-ink'
                  : 'bg-surface-2 text-muted',
            )}
          >
            {step > it.n ? <Check size={13} /> : it.n}
          </div>
          <div className={cx('text-[13px] font-medium', step >= it.n ? 'text-ink' : 'text-muted')}>
            {it.label}
          </div>
          {i < items.length - 1 && <div className="flex-1 h-0.5 bg-surface-2 rounded" />}
        </div>
      ))}
    </div>
  )
}

function ImportStepFile({ onFile, pastedText, setPastedText, onPasteContinue, busy }) {
  const [drag, setDrag] = useState(false)
  const onDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-info-soft text-info text-[13px]">
        <TriangleAlert size={16} className="shrink-0 mt-0.5" />
        <span>
          Поддерживаются Excel (.xlsx, .xls) и CSV/TSV. На следующем шаге вы укажете, какая
          колонка соответствует какому полю товара — автомап сработает по русским
          заголовкам, и вы сможете его подправить.
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-2xl border-2 border-dashed p-8 text-center transition',
          drag ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2',
        )}
      >
        <FileUp size={40} className="mx-auto mb-3 text-muted" />
        <div className="font-semibold mb-1">Перетащите файл сюда</div>
        <div className="text-[12px] text-muted mb-4">
          Excel (.xlsx, .xls) или CSV / TSV
        </div>
        <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand text-brand-ink text-sm font-medium cursor-pointer hover:opacity-90">
          <FileUp size={16} /> {busy ? 'Читаем…' : 'Выбрать файл'}
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="hidden"
          />
        </label>
      </div>

      <div className="relative flex items-center gap-3 text-[12px] text-muted my-3">
        <div className="flex-1 h-px bg-line" />
        или вставьте из буфера
        <div className="flex-1 h-px bg-line" />
      </div>

      <Textarea
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
        rows={5}
        placeholder="Скопируйте строки из Excel (Ctrl+C) и вставьте сюда"
        className="font-mono text-[12px]"
      />
      <div className="flex justify-end">
        <Button icon={Check} disabled={!pastedText.trim()} onClick={onPasteContinue}>
          Продолжить
        </Button>
      </div>
    </div>
  )
}

function ImportStepMapping({ table, mapping, setMapping }) {
  const setField = (field, colIdx) => {
    setMapping((m) => {
      const n = { ...m }
      if (colIdx === '' || colIdx == null) delete n[field]
      else n[field] = Number(colIdx)
      return n
    })
  }
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-muted">
        Автомап уже сработал по заголовкам. Проверьте: каждой сущности слева должна соответствовать
        нужная колонка справа. Обязательные — «Артикул» и «Название».
      </div>

      <div className="border border-line rounded-xl overflow-hidden">
        {IMPORT_FIELDS.map((f) => (
          <div
            key={f.key}
            className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium flex items-center gap-1.5">
                {f.label}
                {f.required && <span className="text-bad">*</span>}
              </div>
              <div className="text-[11px] text-muted">
                {f.key}
                {f.numeric && ' · число'}
              </div>
            </div>
            <select
              value={mapping[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
              className={cx(
                'h-9 px-2 rounded-lg bg-surface-2 border text-[13px] outline-none focus:border-brand min-w-[180px]',
                f.required && mapping[f.key] == null ? 'border-bad' : 'border-line',
              )}
            >
              <option value="">— не импортировать —</option>
              {table.headers.map((h, i) => (
                <option key={i} value={i}>
                  {String.fromCharCode(65 + i)}. {h || `(колонка ${i + 1})`}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <details className="rounded-xl bg-surface-2 border border-line p-3 text-[13px]">
        <summary className="cursor-pointer font-medium text-muted">
          Превью первых 5 строк вашего файла
        </summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-muted">
                {table.headers.map((h, i) => (
                  <th key={i} className="py-1.5 px-2 font-medium text-left border-b border-line">
                    {String.fromCharCode(65 + i)}. {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  {row.map((v, j) => (
                    <td key={j} className="py-1 px-2 truncate max-w-[160px]">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function ImportStepPreview({ rows, updCount, newCount, invalidRows }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <Badge tone="brand">Всего: {rows.length}</Badge>
        <Badge tone="ok">Обновится: {updCount}</Badge>
        <Badge tone="info">Новых: {newCount}</Badge>
        {invalidRows.length > 0 && (
          <Badge tone="bad">С ошибками (пропустится): {invalidRows.length}</Badge>
        )}
      </div>
      <div className="border border-line rounded-xl overflow-hidden max-h-[46vh] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 sticky top-0">
            <tr className="text-muted text-left">
              <th className="py-2 px-3 font-medium">#</th>
              <th className="py-2 px-3 font-medium">Артикул</th>
              <th className="py-2 px-3 font-medium">Название</th>
              <th className="py-2 px-3 font-medium">Категория</th>
              <th className="py-2 px-3 font-medium text-right">Цена</th>
              <th className="py-2 px-3 font-medium text-right">Себест.</th>
              <th className="py-2 px-3 font-medium text-right">Остаток</th>
              <th className="py-2 px-3 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.slice(0, 200).map((r, i) => {
              const bad = !r.sku || !r.name
              return (
                <tr key={i} className={bad ? 'bg-bad-soft/30' : ''}>
                  <td className="py-1.5 px-3 tabular-nums text-muted">{r._rowIdx}</td>
                  <td className="py-1.5 px-3 tabular-nums">{r.sku || <span className="text-bad">—</span>}</td>
                  <td className="py-1.5 px-3 truncate max-w-[200px]">
                    {r.name || <span className="text-bad">нет названия</span>}
                  </td>
                  <td className="py-1.5 px-3 text-muted">{r.category || '—'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {r.price ? money(r.price) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-muted">
                    {r.cost ? money(r.cost) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {r.stock != null ? num(r.stock) : '—'}
                  </td>
                  <td className="py-1.5 px-3">
                    {bad ? (
                      <Badge tone="bad">пропустится</Badge>
                    ) : (
                      <Badge tone={r._action === 'update' ? 'ok' : 'info'}>
                        {r._action === 'update' ? 'обновить' : 'новый'}
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > 200 && (
          <div className="text-[12px] text-muted text-center py-2 border-t border-line">
            показаны первые 200 строк, будут импортированы все
          </div>
        )}
      </div>
    </div>
  )
}

// ── Печать этикеток и ценников ──────────────────────────────────────────────
function LabelsModal({ products, onClose }) {
  const [mode, setMode] = useState('labels') // labels | price
  const [sel, setSel] = useState({}) // id -> qty
  const toggle = (id) =>
    setSel((s) => {
      const n = { ...s }
      if (n[id]) delete n[id]
      else n[id] = 1
      return n
    })
  const setQty = (id, q) => setSel((s) => ({ ...s, [id]: Math.max(1, q) }))

  const entries = Object.entries(sel)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id), qty }))
    .filter((e) => e.p)
  const totalLabels = entries.reduce((a, e) => a + e.qty, 0)
  const print = () => (mode === 'labels' ? printLabels(entries) : printPriceTags(entries))

  return (
    <Modal
      open
      onClose={onClose}
      title="Печать"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={Printer} disabled={!entries.length} onClick={print}>
            Печать{totalLabels ? ` (${totalLabels})` : ''}
          </Button>
        </>
      }
    >
      <div className="flex gap-2 mb-4">
        <TypeTab2 active={mode === 'labels'} onClick={() => setMode('labels')} icon={Tags}>
          Этикетки (штрихкод)
        </TypeTab2>
        <TypeTab2 active={mode === 'price'} onClick={() => setMode('price')} icon={Tag}>
          Ценники
        </TypeTab2>
      </div>
      <p className="text-[13px] text-muted mb-3">
        {mode === 'labels'
          ? 'Этикетки со штрихкодом Code128 — сканируются реальным сканером.'
          : 'Ценники для полки: крупная цена, для весовых — «за кг».'}
      </p>
      <div className="space-y-1.5 max-h-[48vh] overflow-y-auto no-scrollbar">
        {products.map((p) => {
          const on = sel[p.id] != null
          return (
            <div
              key={p.id}
              className={cx(
                'flex items-center gap-3 p-2.5 rounded-xl border transition',
                on ? 'border-brand bg-brand-soft' : 'border-line',
              )}
            >
              <button
                onClick={() => toggle(p.id)}
                className={cx(
                  'h-5 w-5 rounded-md grid place-items-center shrink-0 border',
                  on ? 'bg-brand border-brand text-brand-ink' : 'border-line',
                )}
              >
                {on && <Check size={13} />}
              </button>
              <div className="flex-1 min-w-0" onClick={() => toggle(p.id)}>
                <div className="text-sm font-medium truncate cursor-pointer">{p.name}</div>
                <div className="text-[12px] text-muted">
                  {p.sku} · {money(p.price)} · {p.barcode}
                </div>
              </div>
              {on && (
                <input
                  type="number"
                  min="1"
                  value={sel[p.id]}
                  onChange={(e) => setQty(p.id, +e.target.value)}
                  className="w-16 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                />
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
