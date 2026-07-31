import { useRef, useState } from 'react'
import { Button, Field, Input, Modal } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money, num } from '@/shared/lib/format'

// C2: Возврат по чеку. Позволяет вернуть отдельные позиции с указанием
// количества (не больше исходного) и причины. refundOrder в сторе
// делает всю работу: refund-заказ, возврат остатка, moneyTx.
export default function RefundModal({ order, onClose }) {
  const refundOrder = useStore((s) => s.refundOrder)
  const [items, setItems] = useState(() =>
    (order.items || []).map((it) => ({ productId: it.productId, qty: it.qty })),
  )
  const [reason, setReason] = useState('Возврат покупателя')
  const [err, setErr] = useState('')

  const setQty = (productId, qty) =>
    setItems((s) =>
      s.map((it) =>
        it.productId === productId ? { ...it, qty: Math.max(0, Number(qty) || 0) } : it,
      ),
    )

  const total = items.reduce((acc, it) => {
    const oi = order.items.find((x) => x.productId === it.productId)
    return acc + Number(it.qty) * Number(oi?.price || 0)
  }, 0)

  // F1-12: guard от двойного клика — refundOrder создаёт refund-order
  // + moneyTx. Двойной submit = двойной возврат денег и склад в минус.
  const submittedRef = useRef(false)
  const submit = () => {
    setErr('')
    if (submittedRef.current) return
    const filtered = items.filter((it) => it.qty > 0)
    if (filtered.length === 0) {
      setErr('Укажите количество хотя бы одной позиции')
      return
    }
    submittedRef.current = true
    const r = refundOrder(order.id, { items: filtered, reason })
    if (r && r.ok === false) {
      setErr(r.error)
      submittedRef.current = false
      return
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Возврат по ${order.no}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={total <= 0}>
            Оформить возврат · {money(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Укажите количество возвращаемых товаров. Деньги вернутся тем же
          способом, что и были получены (наличные / карта / долг клиента).
        </p>
        <Field label="Причина возврата">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Не подошло / брак / …"
          />
        </Field>
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60 text-muted text-[11.5px] uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3">Товар</th>
                <th className="text-right py-2 px-2 w-24">Куплено</th>
                <th className="text-right py-2 px-2 w-28">Вернуть</th>
                <th className="text-right py-2 px-3 w-24">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => {
                const ri = items.find((x) => x.productId === it.productId)
                const sum = Number(ri?.qty || 0) * Number(it.price || 0)
                return (
                  <tr key={it.productId} className="border-t border-line">
                    <td className="py-2 px-3">{it.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted">
                      {num(it.qty)} {it.unit}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        min="0"
                        max={it.qty}
                        value={ri?.qty || 0}
                        onChange={(e) => setQty(it.productId, e.target.value)}
                        className="w-20 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {money(sum)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <div className="text-[13px] text-bad">{err}</div>}
      </div>
    </Modal>
  )
}
