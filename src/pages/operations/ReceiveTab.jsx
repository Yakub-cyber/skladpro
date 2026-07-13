// Приёмка со сканера/поиска. Средневзвешенная себестоимость обновляется
// автоматически движком проводки при типе документа `purchase`.
import { useState } from 'react'
import { ArrowDownToLine, Check, FileEdit, PackageCheck, Trash2 } from 'lucide-react'
import { Card, Button, Badge, Empty } from '../../components/ui'
import ScannerInput from '../../components/ScannerInput'
import { useStore } from '../../store/useStore'
import { resolveScan } from '../../lib/barcode'
import { ProductSearch, Toast } from './_shared'

export default function ReceiveTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [items, setItems] = useState([])
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000
  const add = (p, q = 1) => {
    setMsg('')
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + q) } : x))
        : [...prev, { productId: p.id, name: p.name, unit: p.unit, qty: q, weighted: p.weighted, cost: p.cost ?? 0 }],
    )
  }
  const onScan = (code) => {
    const r = resolveScan(code, products)
    if (!r) {
      setMsg(`Штрихкод «${code}» не найден в каталоге`)
      return
    }
    add(r.product, r.weighed ? r.weightKg : 1)
    if (r.weighed) setMsg(`Весовой: ${r.product.name} — ${r.weightKg} кг`)
  }
  const total = items.reduce((a, x) => a + x.qty, 0)
  const submit = (post) => {
    addDocument(
      {
        type: 'purchase',
        reason: 'Закупка',
        items: items.map((it) => ({ productId: it.productId, name: it.name, unit: it.unit, qty: it.qty, cost: it.cost })),
      },
      { post },
    )
    setDone(post ? `Оприходовано ${total} ед. в ${items.length} поз.` : `Черновик закупки на ${items.length} поз.`)
    setItems([])
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <PackageCheck size={17} className="text-brand" /> Сканирование
        </h3>
        <ScannerInput onScan={onScan} />
        {msg && <div className="mt-2 text-[13px] text-bad">{msg}</div>}
        <div className="mt-4 pt-4 border-t border-line">
          <div className="text-[13px] text-muted mb-2">Или добавьте вручную:</div>
          <ProductSearch onPick={add} />
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Поступление</h3>
          {total > 0 && <Badge tone="brand">{total} ед.</Badge>}
        </div>
        {done && <Toast>{done}</Toast>}
        {items.length === 0 && !done ? (
          <Empty icon={ArrowDownToLine} title="Отсканируйте товар" text="Позиции появятся здесь." />
        ) : (
          <>
            <div className="space-y-2 max-h-[44vh] overflow-y-auto no-scrollbar">
              {items.map((it) => (
                <div key={it.productId} className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-2">
                  <span className="flex-1 text-sm truncate">{it.name}</span>
                  <input
                    type="number"
                    min={it.weighted ? '0.001' : '1'}
                    step={it.weighted ? '0.001' : '1'}
                    value={it.qty}
                    onChange={(e) =>
                      setItems((arr) =>
                        arr.map((x) =>
                          x.productId === it.productId
                            ? { ...x, qty: Math.max(it.weighted ? 0.001 : 1, +e.target.value) }
                            : x,
                        ),
                      )
                    }
                    className="w-20 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted w-8">{it.unit}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.cost}
                    title="Цена закупки за единицу — обновит себестоимость (средневзвешенно)"
                    onChange={(e) =>
                      setItems((arr) =>
                        arr.map((x) =>
                          x.productId === it.productId ? { ...x, cost: Math.max(0, +e.target.value) } : x,
                        ),
                      )
                    }
                    className="w-24 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted">₽</span>
                  <button
                    onClick={() => setItems((arr) => arr.filter((x) => x.productId !== it.productId))}
                    className="text-muted hover:text-bad"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="flex gap-2 mt-4">
                <Button icon={Check} className="flex-1" onClick={() => submit(true)}>
                  Оприходовать на склад
                </Button>
                <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
                  Черновик
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
