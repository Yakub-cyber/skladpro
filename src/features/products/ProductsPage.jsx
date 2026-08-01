import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  Plus,
  Tags,
  FileUp,
  Download,
  SlidersHorizontal,
  Package,
} from 'lucide-react'
import { Button, Input, Empty, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money } from '@/shared/lib/format'
import { PRODUCT_TYPES } from '@/shared/lib/constants'
import { downloadCsv } from '@/shared/lib/export'
import { reservedByProduct } from '@/shared/lib/orders'
import {
  EMPTY_FILTERS,
  DEFAULT_COLS,
  LS_PRESETS,
  LS_COLS,
  applyOp,
  PAGE_SIZE,
} from '@/features/products/constants'
import { FiltersPanel, PresetsMenu, Chip, TypeChip } from '@/features/products/components/ProductFilters'
import { ColSettingsMenu } from '@/features/products/components/ColumnSettings'
import { BulkActions } from '@/features/products/components/BulkActions'
import { ProductTable } from '@/features/products/components/ProductTable'
import { ProductCards } from '@/features/products/components/ProductCards'
import { ProductModal } from '@/features/products/components/ProductModal'
import { ImportModal } from '@/features/products/components/ImportWizard'
import { LabelsModal } from '@/features/products/components/LabelsModal'

export default function Products() {
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const productCategories = useMemo(() => [...new Set(products.map(p => p.category).filter(Boolean))].sort(), [products])
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
  // F1-11: `?cost=0` — переход с Dashboard-виджета «Оценка склада» по
  // «cost=0 у N позиций». Спец-режим: показывает только товары с
  // cost=0 и stock>0 (та же выборка что в виджете).
  const showCostZero = params.get('cost') === '0'
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
      // F1-11: если пришли по ?cost=0 — показываем только позиции с
      // нулевой себестоимостью и положительным остатком (та же выборка
      // что виджет «Оценка склада» на Dashboard).
      if (showCostZero) {
        if (!(Number(p.stock) > 0 && !(Number(p.cost) > 0))) return false
      }
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
  }, [products, q, cat, filters, typeFilter, showCostZero])

  // Пагинация: на демо-30 SKU незаметно, на реальном оптовом каталоге
  // (тысячи позиций) полный рендер таблицы тормозит. Показываем окно
  // фиксированного размера, кнопкой добираем ещё. Сброс при смене
  // фильтра/поиска — чтобы пользователь видел свежий срез, а не «висящий»
  // конец прошлого фильтра.
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
          {productCategories.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c}
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

      {filtersOpen && (
        <FiltersPanel
          filters={filters}
          setFilters={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
          activeCount={activeFiltersCount}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      <ProductCards
        shown={shown}
        list={list}
        onEdit={setEdit}
        reserved={reserved}
        products={products}
      />

      {selected.size > 0 && (
        <BulkActions selected={selected} shown={shown} onClear={clearSelection} />
      )}

      <ProductTable
        shown={shown}
        list={list}
        cols={cols}
        selected={selected}
        onToggleOne={toggleOne}
        onToggleAll={(ids) => setSelected(new Set(ids))}
        onClearSelection={clearSelection}
        onEdit={setEdit}
        reserved={reserved}
        products={products}
      />

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
