import { useMemo, useState } from 'react'
import {
  Check,
  PackagePlus,
  Tags,
  ImagePlus,
  X,
  Barcode,
  RefreshCw,
  ScanLine,
  Camera,
} from 'lucide-react'
import { compressImage } from '@/shared/lib/image'
import {
  Modal,
  Button,
  Field,
  Input,
  Select,
  cx,
} from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money } from '@/shared/lib/format'
import { PRODUCT_TYPES } from '@/shared/lib/constants'
import { CELLS } from '@/shared/store/seed'
import { barcodeSVG } from '@/shared/lib/labels'
import { generateEan13 } from '@/shared/lib/barcode'
import ScannerInput from '@/shared/components/ScannerInput'
import { useConfirm } from '@/shared/components/Confirm'
import { KitComponentsEditor } from '@/features/products/components/KitComponentsEditor'
import { printLabels } from '@/shared/lib/labels'

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

export function ProductModal({ product, onClose }) {
  const { addProduct, updateProduct, addDocument, removeProduct, priceTypes, products: allProducts } = useStore()
  const productCategories = useMemo(() => [...new Set(allProducts.map(p => p.category).filter(Boolean))].sort(), [allProducts])
  const confirm = useConfirm()
  const handleRemove = async () => {
    const ok = await confirm({
      title: `Удалить «${product.name}»?`,
      body: 'Товар пропадёт из каталога. История продаж и остатки в закрытых документах сохранятся.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) {
      // F1-1: обрабатываем {ok:false} — если товар в открытом заказе,
      // модалка остаётся открытой и показывает причину.
      const r = removeProduct(product.id)
      if (r && r.ok === false) {
        alert(r.error)
        return
      }
      onClose()
    }
  }
  const isNew = !product
  const [f, setF] = useState(
    product || {
      type: 'product',
      name: '',
      sku: '',
      category: '',
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
      addDocument({
        type: 'stockin',
        items: [{ productId: product.id, name: product.name, unit: product.unit, qty: n }],
      })
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
            <Input
              value={f.category}
              onChange={(e) => set('category', e.target.value)}
              list="product-categories"
              placeholder="Введите или выберите категорию"
            />
            <datalist id="product-categories">
              {productCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
                setF((s) => ({ ...s, cost }))
              }}
            />
          </Field>
          <Field label="Цена продажи, ₽">
            <Input
              type="number"
              value={priceOf(defType)}
              onChange={(e) => {
                const price = Number(e.target.value) || 0
                setF((s) => ({
                  ...s,
                  price,
                  prices: { ...s.prices, [defType]: price },
                }))
              }}
            />
          </Field>
          <Field label="Наценка, %" hint="пересчитывает цену продажи">
            <Input
              type="number"
              value={(() => {
                const price = Number(f.prices?.[defType] ?? f.price) || 0
                const cost = Number(f.cost) || 0
                if (!cost) return ''
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
          {/* C3: ставка НДС товара. Пусто = «наследовать от компании»
              (settings.company.vatRate → 20% fallback). Показывается в
              чеке POS и печатной форме накладной. */}
          <Field label="НДС" hint="Пусто — берём ставку компании (по умолчанию 20%)">
            <Select
              value={
                f.vatRate === null || f.vatRate === undefined ? '' : String(f.vatRate)
              }
              onChange={(e) => {
                const v = e.target.value
                set('vatRate', v === '' ? null : Number(v))
              }}
            >
              <option value="">Как у компании</option>
              <option value="0">0%</option>
              <option value="10">10% (продукты/детские)</option>
              <option value="20">20% (общая)</option>
            </Select>
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
