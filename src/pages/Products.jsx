import { useMemo, useState } from 'react'
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
import { CATEGORIES, catInfo } from '../lib/constants'
import { CELLS } from '../store/seed'
import { printLabels, printPriceTags, barcodeSVG } from '../lib/labels'
import { parsePriceTable, SAMPLE_TEMPLATE } from '../lib/importPrice'
import { downloadCsv } from '../lib/export'
import { reservedByProduct } from '../lib/orders'
import { generateEan13 } from '../lib/barcode'
import ScannerInput from '../components/ScannerInput'

const CAT_ICON = { Wrench, Hammer, Zap, Droplets, PaintBucket, Package }

const stockTone = (p) =>
  p.stock <= p.minStock ? 'bad' : p.stock <= p.minStock * 1.5 ? 'warn' : 'ok'

export default function Products() {
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [cat, setCat] = useState('all')
  const [edit, setEdit] = useState(null) // product | 'new' | null
  const [showImport, setShowImport] = useState(false)
  const [showLabels, setShowLabels] = useState(false)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ =
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags.some((t) => t.includes(s))
      return okC && okQ
    })
  }, [products, q, cat])

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

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
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

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line bg-surface-2/40">
                <th className="font-medium py-3 px-4">Товар</th>
                <th className="font-medium py-3 px-3 hidden md:table-cell">Категория</th>
                <th className="font-medium py-3 px-3">Ячейка</th>
                <th className="font-medium py-3 px-3 text-right">Цена</th>
                <th className="font-medium py-3 px-4 text-right">Остаток</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((p) => {
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
                    <td className="py-2.5 px-3 hidden md:table-cell">
                      <span className="text-[13px]" style={{ color: c.color }}>
                        {p.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge tone="muted">
                        <MapPin size={11} /> {p.cell}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {money(p.price)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Badge tone={stockTone(p)}>
                        {num(p.stock)} {p.unit}
                      </Badge>
                      {reserved[p.id] > 0 && (
                        <div className="text-[11px] text-muted mt-0.5 tabular-nums">
                          резерв {num(reserved[p.id])} · дост. {num(p.stock - reserved[p.id])}
                        </div>
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
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await compressImage(file)
      onChange(dataUrl)
    } catch {
      // игнорируем
    }
    setBusy(false)
    e.target.value = ''
  }
  return (
    <div className="flex items-center gap-3">
      <div className="h-20 w-20 rounded-xl bg-surface-2 border border-line overflow-hidden grid place-items-center shrink-0">
        {value ? (
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus size={24} className="text-muted" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm cursor-pointer w-fit">
          <ImagePlus size={15} /> {busy ? 'Обработка…' : value ? 'Заменить фото' : 'Добавить фото'}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
        {value && (
          <button
            onClick={() => onChange('')}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-bad w-fit px-1"
          >
            <X size={13} /> Убрать
          </button>
        )}
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
  const { addProduct, updateProduct, adjustStock, removeProduct, priceTypes } = useStore()
  const isNew = !product
  const [f, setF] = useState(
    product || {
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
    },
  )
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
              onClick={() => {
                removeProduct(product.id)
                onClose()
              }}
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
        <ImageField value={f.image} onChange={(v) => set('image', v)} />
        {!isNew && (
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

        <BarcodeField value={f.barcode} onChange={(v) => set('barcode', v)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ед. изм.">
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          </Field>
          <Field label="Закупка, ₽">
            <Input
              type="number"
              value={f.cost}
              onChange={(e) => set('cost', +e.target.value)}
            />
          </Field>
        </div>

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

        <div className="pt-1 space-y-2">
          <span className="block text-[13px] font-medium text-muted">Тип товара</span>
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
      </div>
    </Modal>
  )
}

// ── Импорт прайса из Excel/CSV ─────────────────────────────────────────────
function ImportModal({ onClose }) {
  const { products, updateProduct, addProduct } = useStore()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [done, setDone] = useState(0)

  const analyze = (t) => {
    setText(t)
    setParsed(t.trim() ? parsePriceTable(t, products) : null)
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => analyze(String(reader.result))
    reader.readAsText(file, 'utf-8')
  }

  const apply = () => {
    let n = 0
    for (const r of parsed.rows) {
      const data = {
        sku: r.sku,
        name: r.name,
        category: r.category || 'Расходники',
        unit: r.unit || 'шт',
        price: r.price || 0,
        cost: r.cost || 0,
        minStock: r.minStock || 0,
        cell: r.cell || CELLS[0].id,
      }
      if (r._action === 'update' && r._existing) {
        const patch = {}
        // обновляем только переданные числовые/текстовые поля
        ;['name', 'category', 'unit', 'price', 'cost', 'minStock', 'cell'].forEach((k) => {
          if (r[k] != null && r[k] !== '') patch[k] = r[k]
        })
        if (r.stock != null && r.stock !== '') patch.stock = r.stock
        updateProduct(r._existing.id, patch)
      } else {
        addProduct({ ...data, stock: r.stock || 0 })
      }
      n++
    }
    setDone(n)
    setTimeout(onClose, 1200)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + SAMPLE_TEMPLATE.replace(/\t/g, ';')], {
      type: 'text/csv',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shablon-praysa.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const updCount = parsed?.rows.filter((r) => r._action === 'update').length || 0
  const newCount = parsed?.rows.filter((r) => r._action === 'new').length || 0

  return (
    <Modal
      open
      onClose={onClose}
      title="Импорт прайса"
      wide
      footer={
        <>
          <Button variant="ghost" icon={Download} onClick={downloadTemplate} className="mr-auto">
            Шаблон CSV
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={apply} disabled={!parsed?.rows.length} icon={Check}>
            {done ? `Готово: ${done}` : `Применить${parsed?.rows.length ? ` (${parsed.rows.length})` : ''}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-xl bg-info-soft text-info text-[13px]">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <span>
            Скопируйте строки из Excel и вставьте сюда, либо загрузите .csv. Колонки: артикул,
            название, категория, ед, цена, закупка, остаток, минимум, ячейка. Совпадение по
            артикулу — обновит товар, новый — добавит.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 text-sm cursor-pointer">
            <FileUp size={15} /> Загрузить CSV
            <input type="file" accept=".csv,.txt,.tsv" onChange={onFile} className="hidden" />
          </label>
          <span className="text-[12px] text-muted">или вставьте таблицу ниже</span>
        </div>

        <Textarea
          value={text}
          onChange={(e) => analyze(e.target.value)}
          rows={5}
          placeholder={'КР-0070\tГвозди 3×70\tКрепёж\tкг\t98\t64\t150\t40\tA1'}
          className="font-mono text-[12px]"
        />

        {parsed && (
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm">
              <Badge tone="ok">Обновится: {updCount}</Badge>
              <Badge tone="brand">Новых: {newCount}</Badge>
            </div>
            <div className="border border-line rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 sticky top-0">
                  <tr className="text-muted text-left">
                    <th className="py-2 px-3 font-medium">Артикул</th>
                    <th className="py-2 px-3 font-medium">Название</th>
                    <th className="py-2 px-3 font-medium text-right">Цена</th>
                    <th className="py-2 px-3 font-medium text-right">Остаток</th>
                    <th className="py-2 px-3 font-medium">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parsed.rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-3 tabular-nums">{r.sku || '—'}</td>
                      <td className="py-1.5 px-3 truncate max-w-[200px]">{r.name || '—'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {r.price ? money(r.price) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums">
                        {r.stock != null ? num(r.stock) : '—'}
                      </td>
                      <td className="py-1.5 px-3">
                        <Badge tone={r._action === 'update' ? 'ok' : 'brand'}>
                          {r._action === 'update' ? 'обновить' : 'новый'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
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
