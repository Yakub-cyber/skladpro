import { useEffect, useMemo, useRef, useState } from 'react'
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
  Star,
  Camera,
  SlidersHorizontal,
  Trash2,
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
import { money, num, plural } from '../lib/format'
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
// Формат «Цена/Остатки» — оператор + значение (как в CloudShop):
// priceOp ∈ '>', '<', '=' + priceVal — число или пусто (не фильтруем).
const EMPTY_FILTERS = {
  priceOp: '>',
  priceVal: '',
  stockOp: '>',
  stockVal: '',
  stockStatus: 'any', // any | low (ниже min) | out (0) | in
  weighted: 'any',
  marked: 'any',
}

// Ключи в localStorage для пресетов фильтров и настроек колонок.
const LS_PRESETS = 'sklad.products.filterPresets'
const LS_COLS = 'sklad.products.visibleCols'

// Дефолтный набор видимых колонок (CloudShop-эталон).
const DEFAULT_COLS = {
  image: true,      // Фото
  sku: true,        // Артикул / Код
  category: true,   // Категория
  unit: false,      // Ед. изм.
  minStock: true,   // Мин.
  reserved: true,   // Резерв
  available: true,  // Доступно
  cost: true,       // Себестоимость
  price: true,      // Цена
  margin: false,    // Маржа (price − cost)
  cell: true,       // Ячейка
  stock: true,      // Остаток
}

// Применение операторного фильтра. op ∈ '>', '<', '='; val — число или пусто.
function applyOp(value, op, val) {
  if (val === '' || val == null) return true
  const v = Number(value) || 0
  const t = Number(val)
  if (op === '>') return v > t
  if (op === '<') return v < t
  return v === t
}

export default function Products() {
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const removeProduct = useStore((s) => s.removeProduct)
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [cat, setCat] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all') // all | product | service | kit
  const [edit, setEdit] = useState(null) // product | 'new' | null
  const [showImport, setShowImport] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  // Инициализация фильтров: подхватываем `stockStatus` из URL (кликом
  // с Dashboard «Ниже минимума» приходим сюда с ?stockStatus=low и
  // сразу видим товары с низким остатком, а не общий каталог).
  const [filters, setFilters] = useState(() => {
    const stockStatus = params.get('stockStatus')
    if (['low', 'out', 'in'].includes(stockStatus)) {
      return { ...EMPTY_FILTERS, stockStatus }
    }
    return EMPTY_FILTERS
  })
  const [filtersOpen, setFiltersOpen] = useState(() =>
    ['low', 'out', 'in'].includes(params.get('stockStatus')),
  )
  // Bulk-select: множество id выбранных товаров. При выборе появляется
  // sticky-тулбар с массовыми действиями (печать этикеток, удалить).
  const [selected, setSelected] = useState(() => new Set())
  const confirm = useConfirm()
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const clearSelection = () => setSelected(new Set())
  // ESC — снять выбор. Не мешает Modal (у той свой listener).
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e) => e.key === 'Escape' && clearSelection()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size])

  // Число активных фильтров — для бейджа рядом с кнопкой «Фильтр».
  const activeFiltersCount = useMemo(() => {
    let n = 0
    if (filters.priceVal !== '') n++
    if (filters.stockVal !== '') n++
    if (filters.stockStatus !== 'any') n++
    if (filters.weighted !== 'any') n++
    if (filters.marked !== 'any') n++
    return n
  }, [filters])

  // Пресеты фильтров — [{name, filters}] в localStorage. Ручное
  // сохранение/применение/удаление через dropdown рядом с «Фильтр».
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_PRESETS) || '[]')
    } catch { return [] }
  })
  const savePresets = (next) => {
    setPresets(next)
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(next)) } catch {}
  }

  // Видимость колонок таблицы — {image, sku, ...} в localStorage.
  // Управляется popover'ом-шестерёнкой.
  const [cols, setCols] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_COLS) || 'null')
      return raw ? { ...DEFAULT_COLS, ...raw } : DEFAULT_COLS
    } catch { return DEFAULT_COLS }
  })
  const saveCols = (next) => {
    setCols(next)
    try { localStorage.setItem(LS_COLS, JSON.stringify(next)) } catch {}
  }

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
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
      // Цена / остатки — операторный фильтр (>, <, =).
      if (!applyOp(p.price, filters.priceOp, filters.priceVal)) return false
      if (!applyOp(p.stock, filters.stockOp, filters.stockVal)) return false
      // Статус остатка.
      const stock = Number(p.stock) || 0
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
          <ColSettingsMenu cols={cols} onChange={saveCols} />
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
        <PresetsMenu
          presets={presets}
          currentFilters={filters}
          activeCount={activeFiltersCount}
          onApply={(f) => setFilters(f)}
          onSave={(name) => {
            const next = [...presets.filter((p) => p.name !== name), { name, filters }]
            savePresets(next)
          }}
          onRemove={(name) => savePresets(presets.filter((p) => p.name !== name))}
        />
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

      {/* Sticky-тулбар при выделении. Всплывает сверху с массовыми
          действиями. Тёмный цвет — чтобы контрастировал с обычной таблицей. */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-10 -mx-4 lg:-mx-6 px-4 lg:px-6 mb-3">
          <div className="rounded-xl bg-ink text-white shadow-xl shadow-ink/20 flex items-center gap-3 px-4 py-2.5 animate-fadeUp">
            <div className="h-5 w-5 rounded bg-brand grid place-items-center shrink-0">
              <Check size={13} strokeWidth={3} />
            </div>
            <span className="text-[13px] font-semibold">
              Выбрано {selected.size} {plural(selected.size, 'товар', 'товара', 'товаров')}
            </span>
            <div className="h-5 w-px bg-white/15 mx-1" />
            <button
              onClick={() => {
                const chosen = shown.filter((p) => selected.has(p.id)).map((p) => ({ p, qty: 1 }))
                if (chosen.length) printLabels(chosen)
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-[12.5px] font-semibold transition"
            >
              <Tags size={14} /> Печать этикеток
            </button>
            <button
              onClick={async () => {
                const chosen = shown.filter((p) => selected.has(p.id))
                const ok = await confirm({
                  title: `Удалить ${chosen.length} ${plural(chosen.length, 'товар', 'товара', 'товаров')}?`,
                  body: 'Товары пропадут из каталога. История продаж и остатки в закрытых документах сохранятся.',
                  details: chosen.length > 3
                    ? `${chosen.slice(0, 3).map((p) => p.name).join(' · ')} и ещё ${chosen.length - 3}`
                    : chosen.map((p) => p.name).join(' · '),
                  tone: 'danger',
                  okLabel: `Удалить ${chosen.length}`,
                  requireInput: chosen.length >= 5 ? 'УДАЛИТЬ' : undefined,
                })
                if (ok) {
                  chosen.forEach((p) => removeProduct(p.id))
                  clearSelection()
                }
              }}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-bad text-white hover:brightness-110 text-[12.5px] font-semibold transition"
            >
              <Trash2 size={14} /> Удалить
            </button>
            <span className="ml-auto text-[11px] text-white/60 hidden sm:inline">ESC — снять выбор</span>
            <button
              onClick={clearSelection}
              className="h-7 w-7 grid place-items-center rounded-md hover:bg-white/10"
              title="Снять выбор"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Десктопная таблица */}
      <Card className="overflow-hidden hidden lg:block">
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line bg-surface-2/40">
                <th className="font-medium py-3 pl-4 pr-2 w-8">
                  <input
                    type="checkbox"
                    checked={shown.length > 0 && shown.every((p) => selected.has(p.id))}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !shown.every((p) => selected.has(p.id))
                    }}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(shown.map((p) => p.id)))
                      else clearSelection()
                    }}
                    className="h-4 w-4 rounded cursor-pointer accent-brand"
                    aria-label="Выделить все"
                  />
                </th>
                <th className="font-medium py-3 px-4">Товар</th>
                {cols.category && (
                  <th className="font-medium py-3 px-3 hidden xl:table-cell">Категория</th>
                )}
                {cols.unit && (
                  <th className="font-medium py-3 px-3 text-center">Ед.</th>
                )}
                {cols.cell && (
                  <th className="font-medium py-3 px-3 hidden xl:table-cell">Ячейка</th>
                )}
                {cols.cost && (
                  <th className="font-medium py-3 px-3 text-right">Себест.</th>
                )}
                {cols.price && (
                  <th className="font-medium py-3 px-3 text-right">Цена</th>
                )}
                {cols.margin && (
                  <th className="font-medium py-3 px-3 text-right">Маржа</th>
                )}
                {cols.minStock && (
                  <th className="font-medium py-3 px-3 text-right">Мин.</th>
                )}
                {cols.reserved && (
                  <th className="font-medium py-3 px-3 text-right">Резерв</th>
                )}
                {cols.available && (
                  <th className="font-medium py-3 px-3 text-right">Доступно</th>
                )}
                {cols.stock && (
                  <th className="font-medium py-3 px-4 text-right">Остаток</th>
                )}
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
                    className={cx(
                      'hover:bg-surface-2/50 transition cursor-pointer',
                      selected.has(p.id) && 'bg-brand-soft/40',
                    )}
                    onClick={() => setEdit(p)}
                  >
                    <td className="py-2.5 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                        className="h-4 w-4 rounded cursor-pointer accent-brand"
                        aria-label={`Выделить ${p.name}`}
                      />
                    </td>
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
                    {cols.category && (
                      <td className="py-2.5 px-3 hidden xl:table-cell">
                        <span className="text-[13px]" style={{ color: c.color }}>
                          {p.category}
                        </span>
                      </td>
                    )}
                    {cols.unit && (
                      <td className="py-2.5 px-3 text-center text-muted">
                        {p.unit}
                      </td>
                    )}
                    {cols.cell && (
                      <td className="py-2.5 px-3 hidden xl:table-cell">
                        <Badge tone="muted">
                          <MapPin size={11} /> {p.cell}
                        </Badge>
                      </td>
                    )}
                    {cols.cost && (
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                        {money(p.cost)}
                      </td>
                    )}
                    {cols.price && (
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {money(p.price)}
                      </td>
                    )}
                    {cols.margin && (
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <span className={cx(p.price - p.cost > 0 ? 'text-ok' : 'text-muted')}>
                          {money((p.price || 0) - (p.cost || 0))}
                        </span>
                      </td>
                    )}
                    {cols.minStock && (
                      <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                        {num(p.minStock || 0)}
                      </td>
                    )}
                    {cols.reserved && (
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {reserved[p.id] > 0 ? (
                          <span className="text-warn">{num(reserved[p.id])}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                    {cols.available && (
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {num(Math.max(0, p.stock - (reserved[p.id] || 0)))}
                      </td>
                    )}
                    {cols.stock && (
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
                    )}
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
        <OperatorField
          label="Цена, ₽"
          op={filters.priceOp}
          val={filters.priceVal}
          onOp={(v) => set('priceOp', v)}
          onVal={(v) => set('priceVal', v)}
        />
        <OperatorField
          label="Остаток"
          op={filters.stockOp}
          val={filters.stockVal}
          onOp={(v) => set('stockOp', v)}
          onVal={(v) => set('stockVal', v)}
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

// Оператор + значение (как в CloudShop): [Select >/<=/=] [Input число].
// Пустое значение выключает фильтр.
function OperatorField({ label, op, val, onOp, onVal }) {
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <select
          value={op}
          onChange={(e) => onOp(e.target.value)}
          className="h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand shrink-0"
        >
          <option value=">">больше</option>
          <option value="<">меньше</option>
          <option value="=">равно</option>
        </select>
        <input
          type="number"
          value={val}
          onChange={(e) => onVal(e.target.value)}
          placeholder="значение"
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

// Меню пресетов: выпадашка с сохранёнными наборами фильтров + кнопки
// «Сохранить как…» и «Удалить». Хранится в localStorage
// LS_PRESETS = 'sklad.products.filterPresets'.
function PresetsMenu({ presets, currentFilters, activeCount, onApply, onSave, onRemove }) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false); setNaming(false); setName('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const save = () => {
    const n = name.trim()
    if (!n) return
    onSave(n)
    setNaming(false)
    setName('')
    setOpen(false)
  }
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-10 px-3 rounded-xl inline-flex items-center gap-2 text-sm font-medium border border-line bg-surface-2 text-muted hover:text-ink transition"
        title="Пресеты фильтров"
      >
        <Star size={16} />
        <span className="hidden sm:inline">Пресеты</span>
        {presets.length > 0 && (
          <span className="text-[11px] font-semibold text-muted">
            {presets.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 card p-2 z-30 animate-fadeUp">
          {presets.length === 0 && !naming && (
            <div className="text-[12px] text-muted p-2">
              Пресетов пока нет. Настройте фильтр и «Сохранить как…».
            </div>
          )}
          {presets.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-1 p-1 rounded-lg hover:bg-surface-2"
            >
              <button
                onClick={() => { onApply(p.filters); setOpen(false) }}
                className="flex-1 text-left text-[13px] px-2 py-1.5 rounded-md hover:text-brand truncate"
              >
                {p.name}
              </button>
              <button
                onClick={() => onRemove(p.name)}
                className="h-7 w-7 rounded-md text-muted hover:text-bad grid place-items-center"
                title="Удалить пресет"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="border-t border-line mt-1 pt-1">
            {naming ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  placeholder="Название пресета"
                  autoFocus
                  className="flex-1 h-8 px-2 rounded-md bg-surface-2 border border-line text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={save}
                  disabled={!name.trim()}
                  className="h-8 px-2 rounded-md bg-brand text-brand-ink text-[12px] font-medium disabled:opacity-50"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                disabled={activeCount === 0}
                className="w-full text-left text-[13px] px-2 py-1.5 rounded-md hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={activeCount === 0 ? 'Задайте фильтры сначала' : ''}
              >
                + Сохранить текущий как пресет
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Меню «Настройки таблицы» — 12 чекбоксов колонок; сохранение по
// клику мгновенно в localStorage. Дефолты — DEFAULT_COLS.
function ColSettingsMenu({ cols, onChange }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const toggle = (k) => onChange({ ...cols, [k]: !cols[k] })
  const items = [
    ['image', 'Фотография'],
    ['sku', 'Артикул / код'],
    ['category', 'Категория'],
    ['unit', 'Единица измерения'],
    ['cell', 'Ячейка'],
    ['stock', 'Остаток'],
    ['minStock', 'Мин. остаток'],
    ['reserved', 'Резерв'],
    ['available', 'Доступно'],
    ['cost', 'Себестоимость'],
    ['price', 'Цена продажи'],
    ['margin', 'Маржа (₽)'],
  ]
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-10 rounded-xl grid place-items-center border border-line bg-surface-2 text-muted hover:text-ink transition"
        title="Настройки таблицы"
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 card p-2 z-30 animate-fadeUp">
          <div className="text-[11px] font-semibold text-muted px-2 py-1.5 uppercase">
            Настройки таблицы
          </div>
          {items.map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer text-[13px]"
            >
              <input
                type="checkbox"
                checked={!!cols[key]}
                onChange={() => toggle(key)}
                className="accent-brand w-4 h-4"
              />
              {label}
            </label>
          ))}
        </div>
      )}
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
        <div className="grid grid-cols-3 gap-3">
          <Field label="Ед. изм.">
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          </Field>
          {/* Себестоимость + наценка: связаны с ценой продажи по-умолчанию
              (defType). Пользователь меняет любое из трёх — остальные
              пересчитываются. Похоже на CloudShop-модалку товара. */}
          <Field label={isServiceForm ? 'Себестоимость, ₽' : 'Закупка, ₽'}>
            <Input
              type="number"
              value={f.cost}
              onChange={(e) => {
                const cost = +e.target.value
                setF((s) => {
                  const price = Number(s.prices?.[defType] ?? s.price) || 0
                  // Если задана цена продажи > 0 — держим её, пересчитываем %
                  // при отсутствующей цене — не трогаем prices, ждём отдельной правки.
                  return { ...s, cost }
                })
              }}
            />
          </Field>
          <Field label="Наценка, %" hint="изменяет цену продажи (базовую)">
            <Input
              type="number"
              value={(() => {
                const price = Number(f.prices?.[defType] ?? f.price) || 0
                const cost = Number(f.cost) || 0
                if (!cost) return ''
                // Округление до 0.1%: (price-cost)/cost * 100 = %.
                return Math.round(((price - cost) / cost) * 1000) / 10
              })()}
              onChange={(e) => {
                const margin = +e.target.value
                const cost = Number(f.cost) || 0
                if (!cost) return
                const price = Math.round(cost * (1 + margin / 100))
                setF((s) => ({
                  ...s,
                  price,
                  prices: { ...s.prices, [defType]: price },
                }))
              }}
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

        {/* Характеристики: габариты и вес — для доставки, паллетирования,
            расчёта веса упаковки. Услуги/комплекты не имеют физических
            размеров. Хранится в product.dimensions = { h, w, d, weight }. */}
        {!isServiceForm && !isKitForm && (
          <div className="pt-1 space-y-2">
            <span className="block text-[13px] font-medium text-muted">Характеристики</span>
            <div className="grid grid-cols-4 gap-2">
              <Field label="Высота, см">
                <Input
                  type="number"
                  value={f.dimensions?.h ?? ''}
                  onChange={(e) =>
                    set('dimensions', { ...(f.dimensions || {}), h: +e.target.value })
                  }
                />
              </Field>
              <Field label="Ширина, см">
                <Input
                  type="number"
                  value={f.dimensions?.w ?? ''}
                  onChange={(e) =>
                    set('dimensions', { ...(f.dimensions || {}), w: +e.target.value })
                  }
                />
              </Field>
              <Field label="Глубина, см">
                <Input
                  type="number"
                  value={f.dimensions?.d ?? ''}
                  onChange={(e) =>
                    set('dimensions', { ...(f.dimensions || {}), d: +e.target.value })
                  }
                />
              </Field>
              <Field label="Факт. вес, кг">
                <Input
                  type="number"
                  step="0.01"
                  value={f.dimensions?.weight ?? ''}
                  onChange={(e) =>
                    set('dimensions', {
                      ...(f.dimensions || {}),
                      weight: +e.target.value,
                    })
                  }
                />
              </Field>
            </div>
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
