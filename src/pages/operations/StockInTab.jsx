// Оприходование — приход товара БЕЗ поставщика (найденный излишек,
// первичный ввод, находка после инвентаризации, спонсорский товар).
// Отличие от Покупки: нет поставщика, себестоимость — по последней
// средней либо ручная. Движок proceess как type='stockin' работает
// через POST_SIGN=+1 (см. lib/posting.js).
import { useMemo, useState } from 'react'
import { PackagePlus, Check, FileEdit, Trash2 } from 'lucide-react'
import { Card, Button, Badge, Empty, Field, Select } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { money, num } from '../../lib/format'
import { ProductPickerGrid, Toast, useScanResolver } from './_shared'

const REASONS = [
  'Излишек по инвентаризации',
  'Начальный ввод остатков',
  'Возврат из ремонта',
  'Спонсорский / подарок',
  'Прочий приход',
]

export default function StockInTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [reason, setReason] = useState(REASONS[0])
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000

  const add = (p, qty = 1) => {
    setMsg('')
    setErr('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) =>
            x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x,
          )
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
    setErr('')
    const r = addDocument(
      {
        type: 'stockin',
        reason,
        subtotal: total,
        total,
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
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error)
      return
    }
    setDone(
      post
        ? `Оприходовано ${count} ед. в ${items.length} поз. на ${money(total)}`
        : `Черновик оприходования на ${items.length} поз.`,
    )
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
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
      />

      <Card className="p-4 lg:sticky lg:top-20 flex flex-col max-h-[calc(100dvh-6rem)]">
        <div className="flex items-center gap-2 mb-3">
          <PackagePlus size={18} className="text-brand" />
          <h3 className="font-semibold">Оприходование</h3>
          {count > 0 && (
            <Badge tone="brand" className="ml-auto">
              {num(count)}
            </Badge>
          )}
        </div>

        {done && (
          <div className="mb-3">
            <Toast>{done}</Toast>
          </div>
        )}

        <Field label="Причина" className="mb-3">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 min-h-[80px]">
          {items.length === 0 ? (
            <Empty
              icon={PackagePlus}
              title="Пусто"
              text="Выберите товары в каталоге — они появятся здесь с последней себестоимостью."
            />
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.productId} className="p-2.5 rounded-xl bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">
                      {it.name}
                    </span>
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
                      onChange={(e) =>
                        setQty(it.productId, Math.max(0, +e.target.value))
                      }
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
                      title="Себестоимость единицы"
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
            <span className="text-muted text-sm">Сумма прихода</span>
            <span className="text-xl font-semibold tabular-nums">
              {money(total)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              icon={Check}
              className="flex-1"
              onClick={() => submit(true)}
              disabled={!items.length}
            >
              Провести
            </Button>
            <Button
              variant="soft"
              icon={FileEdit}
              onClick={() => submit(false)}
              disabled={!items.length}
            >
              Черновик
            </Button>
          </div>
          {err && <div className="text-[13px] text-bad">{err}</div>}
        </div>
      </Card>
    </div>
  )
}
