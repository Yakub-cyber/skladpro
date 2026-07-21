// Продажа-документ. В отличие от кассы (мгновенная розничная продажа
// через /orders/new), это документ опта: выбор клиента, редактируемая
// цена, скидка, «в долг». Проводится через addDocument(type='sale') —
// движок posting.js списывает остатки по FIFO и пишет COGS в movement.
//
// UX похож на CloudShop: слева каталог с ценами, справа лента чека +
// клиент/скидка/кнопка «Провести».
import { useMemo, useState } from 'react'
import { Check, FileEdit, ShoppingCart, Trash2 } from 'lucide-react'
import { Card, Button, Badge, Empty, Field, Select } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { money, num } from '../../lib/format'
import { priceFor } from '../../lib/constants'
import { ProductPickerGrid, Toast, useScanResolver } from './_shared'

export default function SaleTab() {
  const products = useStore((s) => s.products)
  const customers = useStore((s) => s.customers)
  const priceTypes = useStore((s) => s.priceTypes) || []
  const addDocument = useStore((s) => s.addDocument)
  const updateCustomer = useStore((s) => s.updateCustomer)

  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id || ''
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [customerId, setCustomerId] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [discount, setDiscount] = useState(0)
  const [onCredit, setOnCredit] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000

  const add = (p, qty = 1) => {
    setMsg('')
    setErr('')
    setItems((prev) => {
      const existing = prev.find((x) => x.productId === p.id)
      if (existing) {
        return prev.map((x) =>
          x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x,
        )
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          qty,
          price: priceFor(p, priceTypeId),
          weighted: p.weighted,
        },
      ]
    })
  }
  const setQty = (id, qty) =>
    setItems((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )
  const setPrice = (id, price) =>
    setItems((r) =>
      r.map((x) => (x.productId === id ? { ...x, price: Math.max(0, price) } : x)),
    )

  const changePriceType = (ptId) => {
    setPriceTypeId(ptId)
    setItems((rr) =>
      rr.map((x) => {
        const p = products.find((pp) => pp.id === x.productId)
        if (!p) return x
        return { ...x, price: priceFor(p, ptId) }
      }),
    )
  }
  const selectCustomer = (id) => {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c?.priceTypeId) changePriceType(c.priceTypeId)
  }

  const onScan = useScanResolver(products, add, setMsg)

  const subtotal = items.reduce((a, x) => a + x.qty * x.price, 0)
  const total = Math.round(subtotal * (1 - (Number(discount) || 0) / 100))
  const count = items.reduce((a, x) => a + x.qty, 0)
  const rowsById = useMemo(
    () => Object.fromEntries(items.map((x) => [x.productId, x])),
    [items],
  )

  const submit = (post) => {
    setErr('')
    const cust = customers.find((c) => c.id === customerId)
    const r = addDocument(
      {
        type: 'sale',
        reason: 'Продажа',
        customerId: cust?.id,
        customerName: cust?.name || 'Розничный',
        priceTypeId,
        discount: Number(discount) || 0,
        subtotal,
        total,
        onCredit,
        items: items.map((it) => ({
          productId: it.productId,
          name: it.name,
          unit: it.unit,
          qty: it.qty,
          price: it.price,
        })),
      },
      { post },
    )
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error)
      return
    }
    // При «в долг» с выбранным клиентом — увеличиваем его баланс.
    // (В addDocument нет знания о клиенте — оно есть только в addOrder,
    // поэтому обновляем контрагента здесь напрямую.)
    if (post && onCredit && cust?.id) {
      updateCustomer(cust.id, { balance: (cust.balance || 0) + total })
    }
    setDone(
      post
        ? `Продано ${count} ед. в ${items.length} поз. на ${money(total)}`
        : `Черновик продажи на ${items.length} поз.`,
    )
    setItems([])
    setCustomerId('')
    setDiscount(0)
    setOnCredit(false)
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
        priceField="price"
        showStock
      />

      <Card className="p-4 lg:sticky lg:top-20 flex flex-col max-h-[calc(100dvh-6rem)]">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart size={18} className="text-brand" />
          <h3 className="font-semibold">Документ продажи</h3>
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

        <div className="grid grid-cols-2 gap-2 mb-3">
          <Field label="Клиент">
            <Select
              value={customerId}
              onChange={(e) => selectCustomer(e.target.value)}
            >
              <option value="">Розничный</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Цены">
            <Select
              value={priceTypeId}
              onChange={(e) => changePriceType(e.target.value)}
            >
              {priceTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar -mx-1 px-1 min-h-[80px]">
          {items.length === 0 ? (
            <Empty
              icon={ShoppingCart}
              title="Пусто"
              text="Кликните по товару в каталоге, чтобы добавить его в документ."
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
                      value={it.price}
                      min="0"
                      step="0.01"
                      onChange={(e) => setPrice(it.productId, +e.target.value)}
                      className="w-20 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-right"
                      title="Цена за единицу"
                    />
                    <span className="text-[11px] text-muted">₽</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums">
                      {money(it.qty * it.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-line mt-3 pt-3 space-y-2">
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
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={onCredit}
                disabled={!customerId}
                onChange={(e) => setOnCredit(e.target.checked)}
                className="accent-[var(--brand)]"
              />
              В долг
            </label>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted text-sm">Итого</span>
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
