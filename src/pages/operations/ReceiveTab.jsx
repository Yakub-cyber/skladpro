// Приёмка со сканера/поиска. Средневзвешенная себестоимость (либо новая
// FIFO-партия) обновляется автоматически движком проводки при типе
// документа `purchase`. Слева — сетка товаров с себестоимостью, справа
// — документ поступления с редактируемой ценой закупки.
//
// Единый SmartFind вместо старой пары ScannerInput + ProductSearch —
// USB-сканер + камера + текстовый поиск идут в одно поле.
import { useMemo, useState } from 'react'
import { ArrowDownToLine, Check, FileEdit, Trash2 } from 'lucide-react'
import { Card, Button, Badge, Empty } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { money, num } from '../../lib/format'
import { ProductPickerGrid, Toast, useScanResolver } from './_shared'

export default function ReceiveTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000

  const add = (p, qty = 1) => {
    setMsg('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x))
        : [
            ...prev,
            {
              productId: p.id,
              name: p.name,
              unit: p.unit,
              qty,
              weighted: p.weighted,
              cost: Number(p.cost) || 0,
            },
          ],
    )
  }
  const setQty = (id, qty) =>
    setItems((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )
  const setCost = (id, cost) =>
    setItems((r) => r.map((x) => (x.productId === id ? { ...x, cost: Math.max(0, cost) } : x)))

  const onScan = useScanResolver(products, add, setMsg)

  const total = items.reduce((a, x) => a + x.qty * (Number(x.cost) || 0), 0)
  const count = items.reduce((a, x) => a + x.qty, 0)
  const rowsById = useMemo(
    () => Object.fromEntries(items.map((x) => [x.productId, x])),
    [items],
  )

  const submit = (post) => {
    addDocument(
      {
        type: 'purchase',
        reason: 'Закупка',
        items: items.map((it) => ({
          productId: it.productId,
          name: it.name,
          unit: it.unit,
          qty: it.qty,
          cost: it.cost,
        })),
      },
      { post },
    )
    setDone(post ? `Оприходовано ${count} ед. в ${items.length} поз. на ${money(total)}` : `Черновик закупки на ${items.length} поз.`)
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
      {/* Каталог с текущей себестоимостью — для приёмки это ориентир,
          сколько было заплачено в прошлый раз. */}
      <ProductPickerGrid
        query={q}
        setQuery={setQ}
        onScan={onScan}
        msg={msg}
        cat={cat}
        setCat={setCat}
        rowsById={rowsById}
        onAdd={add}
        onSetQty={setQty}
        priceField="cost"
        showStock
        placeholder="Поиск товара, штрихкод или ввод SKU…"
      />

      {/* Документ приёмки */}
      <Card className="p-4 lg:sticky lg:top-20 flex flex-col max-h-[calc(100dvh-6rem)]">
        <div className="flex items-center gap-2 mb-3">
          <ArrowDownToLine size={18} className="text-brand" />
          <h3 className="font-semibold">Приход на склад</h3>
          {count > 0 && <Badge tone="brand" className="ml-auto">{num(count)}</Badge>}
        </div>

        {done && <div className="mb-3"><Toast>{done}</Toast></div>}

        <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 min-h-[80px]">
          {items.length === 0 ? (
            <Empty icon={ArrowDownToLine} title="Пусто" text="Отсканируйте штрихкод или кликните по товару в каталоге." />
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.productId} className="p-2.5 rounded-xl bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">{it.name}</span>
                    <button
                      onClick={() => setQty(it.productId, 0)}
                      className="text-muted hover:text-bad shrink-0"
                      title="Убрать"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      value={it.qty}
                      min={it.weighted ? '0.001' : '1'}
                      step={it.weighted ? '0.1' : '1'}
                      onChange={(e) => setQty(it.productId, Math.max(0, +e.target.value))}
                      className="w-16 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-center"
                    />
                    <span className="text-[11px] text-muted">{it.unit}</span>
                    <span className="text-[11px] text-muted">×</span>
                    <input
                      type="number"
                      value={it.cost}
                      min="0"
                      step="0.01"
                      onChange={(e) => setCost(it.productId, +e.target.value)}
                      className="w-20 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-right"
                      title="Цена закупки за единицу"
                    />
                    <span className="text-[11px] text-muted">₽</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums">
                      {money(it.qty * (Number(it.cost) || 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line mt-3 pt-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted text-sm">Итого закупки</span>
            <span className="text-xl font-semibold tabular-nums">{money(total)}</span>
          </div>
          <div className="flex gap-2">
            <Button icon={Check} className="flex-1" onClick={() => submit(true)} disabled={!items.length}>
              Оприходовать
            </Button>
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)} disabled={!items.length}>
              Черновик
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
