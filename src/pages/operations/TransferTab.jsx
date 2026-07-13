// Перемещение товара между складами. Общий физический остаток не меняется —
// смещается только warehouseId, отметка в журнале движений (delta=0).
import { useState } from 'react'
import { ArrowLeftRight, ChevronRight, Trash2, FileEdit } from 'lucide-react'
import { Card, Button, Field, Select } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { ProductSearch, Toast } from './_shared'

export default function TransferTab() {
  const warehouses = useStore((s) => s.warehouses) || []
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [toWh, setToWh] = useState(warehouses[0]?.id || '')
  const [done, setDone] = useState('')

  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '—'
  const add = (p) => {
    setDone('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: 1, fromWh: p.warehouseId }],
    )
  }
  const submit = (post) => {
    addDocument({ type: 'transfer', toWarehouseId: toWh, items }, { post })
    setDone(post ? `Перемещено ${items.length} поз. → ${whName(toWh)}` : `Черновик перемещения на ${items.length} поз.`)
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5 max-w-xl">
      <p className="text-[13px] text-muted mb-3">
        Перемещение переносит товар на другой склад. Общий остаток не меняется — движение фиксируется в журнале.
      </p>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}

      <Field label="Склад назначения">
        <Select value={toWh} onChange={(e) => setToWh(e.target.value)}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
      </Field>

      <div className="mt-2">
        <ProductSearch onPick={add} placeholder="Добавить товар к перемещению…" />
      </div>

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          {items.map((it) => (
            <div key={it.productId} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{it.name}</div>
                <div className="text-[11px] text-muted flex items-center gap-1">
                  {whName(it.fromWh)} <ChevronRight size={11} /> {whName(toWh)}
                </div>
              </div>
              <input
                type="number"
                min="1"
                value={it.qty}
                onChange={(e) =>
                  setItems((arr) =>
                    arr.map((x) =>
                      x.productId === it.productId ? { ...x, qty: Math.max(1, +e.target.value) } : x,
                    ),
                  )
                }
                className="w-20 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
              />
              <span className="text-[12px] text-muted w-8">{it.unit}</span>
              <button
                onClick={() => setItems((arr) => arr.filter((x) => x.productId !== it.productId))}
                className="text-muted hover:text-bad"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <Button icon={ArrowLeftRight} className="flex-1" onClick={() => submit(true)} disabled={!toWh}>
              Переместить ({items.length})
            </Button>
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)} disabled={!toWh}>
              Черновик
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
