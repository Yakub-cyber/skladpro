// Общая форма документа на одну позицию: списание, возврат клиенту,
// возврат поставщику. Разница — только тип документа, набор причин и
// подписи. Кнопки «Провести/Черновик» вызывают addDocument, который для
// списания и возврата поставщику блокирует превышение остатка.
import { useState } from 'react'
import { Check, FileEdit, MapPin } from 'lucide-react'
import { Card, Button, Badge, Field, Select } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { num } from '../../lib/format'
import { ProductSearch, Toast } from './_shared'

export default function MoveForm({ docType, reasons, tone, verb, hint }) {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [sel, setSel] = useState(null)
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState(reasons[0])
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

  const cur = sel && products.find((p) => p.id === sel.id)
  const submit = (post) => {
    setErr('')
    const r = addDocument(
      { type: docType, reason, items: [{ productId: sel.id, name: sel.name, unit: sel.unit, qty }] },
      { post },
    )
    // addDocument возвращает id при успехе или { ok:false, error } при
    // превышении остатка на списании/продаже/возврате поставщику.
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error)
      return
    }
    setDone(`${post ? verb : 'Черновик'}: ${sel.name} — ${qty} ${sel.unit}`)
    setSel(null)
    setQty(1)
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5 max-w-xl">
      <p className="text-[13px] text-muted mb-3">{hint}</p>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}
      <ProductSearch onPick={(p) => { setSel(p); setQty(1) }} />

      {sel && (
        <div className="mt-4 p-4 rounded-xl bg-surface-2 animate-fadeUp">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium">{sel.name}</div>
              <div className="text-[12px] text-muted flex items-center gap-1">
                <MapPin size={11} /> {sel.cell} · на складе {num(cur?.stock ?? sel.stock)} {sel.unit}
              </div>
            </div>
            <Badge tone="muted">{sel.sku}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество">
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(Math.max(1, +e.target.value))}
                className="w-full h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand"
              />
            </Field>
            <Field label="Причина">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasons.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <Button className="flex-1" variant={tone} onClick={() => submit(true)} icon={Check}>
              {verb} {qty} {sel.unit}
            </Button>
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
              Черновик
            </Button>
          </div>
          {err && <div className="mt-3 text-[13px] text-bad">{err}</div>}
        </div>
      )}
    </Card>
  )
}
