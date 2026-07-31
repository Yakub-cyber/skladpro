import { useState } from 'react'
import { Check, Search, Truck, X } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from '@/shared/ui'
import { money } from '@/shared/lib/format'

const round3 = (n) => Math.round(n * 1000) / 1000

export default function POModal({ po, suppliers, products, onClose, onSubmit }) {
  const [supplierId, setSupplierId] = useState(po?.supplierId || suppliers[0]?.id || '')
  const [expectedAt, setExpectedAt] = useState(
    po?.expectedAt ? po.expectedAt.slice(0, 10) : '',
  )
  const [note, setNote] = useState(po?.note || '')
  const [items, setItems] = useState(po?.items?.map((it) => ({ ...it })) || [])
  const [q, setQ] = useState('')

  const candidates = products
    .filter((p) => (p.type || 'product') === 'product')
    .filter((p) => {
      const s = q.trim().toLowerCase()
      return !s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)
    })
    .slice(0, 6)

  const addItem = (p) => {
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) =>
            x.productId === p.id ? { ...x, qty: round3(x.qty + 1) } : x,
          )
        : [
            ...prev,
            {
              productId: p.id,
              name: p.name,
              unit: p.unit,
              qty: 1,
              cost: Number(p.cost) || 0,
            },
          ],
    )
    setQ('')
  }
  const setQty = (id, qty) =>
    setItems((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )
  const setCost = (id, cost) =>
    setItems((r) =>
      r.map((x) =>
        x.productId === id ? { ...x, cost: Math.max(0, Number(cost) || 0) } : x,
      ),
    )

  const total = items.reduce(
    (a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0),
    0,
  )

  const submit = () => {
    const sup = suppliers.find((s) => s.id === supplierId)
    onSubmit({
      supplierId,
      supplierName: sup?.name,
      items,
      expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
      note,
    })
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Truck size={18} className="text-brand" />
          {po ? `Правка ${po.no}` : 'Новый заказ поставщику'}
        </span>
      }
    >
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Поставщик">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ожидаемая дата">
            <Input
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">Товары</span>
            <span className="text-[11px] text-muted">
              {items.length ? `${items.length} поз. на ${money(total)}` : ''}
            </span>
          </div>
          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((it) => (
                <div key={it.productId} className="flex items-center gap-2 p-2 rounded-lg bg-surface">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{it.name}</div>
                    <div className="text-[11px] text-muted">× {money(it.cost)}/{it.unit}</div>
                  </div>
                  <input
                    type="number"
                    min="0.001"
                    step="1"
                    value={it.qty}
                    onChange={(e) => setQty(it.productId, +e.target.value)}
                    className="w-20 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted w-8">{it.unit}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.cost}
                    onChange={(e) => setCost(it.productId, e.target.value)}
                    className="w-24 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-right"
                  />
                  <span className="text-[12px] text-muted w-6 text-right">₽</span>
                  <span className="text-[13px] font-semibold tabular-nums w-24 text-right">
                    {money((Number(it.qty) || 0) * (Number(it.cost) || 0))}
                  </span>
                  <button
                    onClick={() => setQty(it.productId, 0)}
                    className="text-muted hover:text-bad"
                    title="Убрать"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти товар для добавления в заказ…"
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-line text-[13px] outline-none focus:border-brand"
            />
            {q && candidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 card p-1 max-h-56 overflow-y-auto">
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addItem(p)}
                    className="w-full flex items-center justify-between gap-2 px-2 h-9 rounded-md hover:bg-surface-2 text-left text-[13px]"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted text-[11px] shrink-0">
                      {p.sku} · закуп {money(p.cost)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <Field label="Комментарий">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Опционально" />
        </Field>

        <div className="flex justify-between items-center pt-1">
          <div className="text-sm text-muted">
            Итого <b className="text-ink tabular-nums">{money(total)}</b>
          </div>
          <div className="flex gap-2">
            <Button icon={Check} disabled={!items.length || !supplierId} onClick={submit}>
              {po ? 'Сохранить' : 'Создать'}
            </Button>
            <Button variant="soft" onClick={onClose}>Отмена</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
