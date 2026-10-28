import { useRef, useState } from 'react'
import { Button, Field, Input, Modal } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money, num } from '@/shared/lib/format'
import { planRefund, remainingRefundItems } from '@/shared/lib/refunds'

// C2: Возврат по чеку. Позволяет вернуть отдельные позиции с указанием
// количества (не больше исходного) и причины. refundOrder в сторе
// делает всю работу: refund-заказ, возврат остатка, moneyTx.
export default function RefundModal({ order, onClose }) {
  const refundOrder = useStore((s) => s.refundOrder)
  const orders = useStore((s) => s.orders)
  const remaining = remainingRefundItems(order, orders)
  const [items, setItems] = useState(() =>
    remaining.map((it) => ({ productId: it.productId, qty: it.qty })),
  )
  const [reason, setReason] = useState('Возврат покупателя')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const setQty = (productId, qty) =>
    setItems((s) =>
      s.map((it) =>
        it.productId === productId ? { ...it, qty: Math.max(0, Number(qty) || 0) } : it,
      ),
    )

  const planned = planRefund(
    order,
    orders,
    items.filter((it) => it.qty > 0),
  )
  const total = planned.ok ? planned.total : 0

  // F1-12: guard от двойного клика — refundOrder создаёт refund-order
  // + moneyTx. Двойной submit = двойной возврат денег и склад в минус.
  const submittedRef = useRef(false)
  const submit = async () => {
    setErr('')
    if (submittedRef.current) return
    const filtered = items.filter((it) => it.qty > 0)
    if (filtered.length === 0) {
      setErr('Укажите количество хотя бы одной позиции')
      return
    }
    submittedRef.current = true
    setBusy(true)
    let r
    try { r = await refundOrder(order.id, { items: filtered, reason }) }
    catch (e) { r = { ok: false, error: e.message } }
    setBusy(false)
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
      onClose={busy ? () => {} : onClose}
      wide
      title={`Возврат по ${order.no}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!planned.ok || busy}>
            Оформить возврат · {money(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Возврат сначала сохраняется на этом устройстве. До подтверждения сервера сумма
          предварительная, выплата не подтверждена. Неподдерживаемая оплата потребует сверки.
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
                <th className="text-right py-2 px-2 w-24">Осталось вернуть</th>
                <th className="text-right py-2 px-2 w-28">Вернуть</th>
                <th className="text-right py-2 px-3 w-24">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => {
                const ri = items.find((x) => x.productId === it.productId)
                const left = remaining.find((x) => x.productId === it.productId)
                const plannedItem = planned.items?.find((x) => x.productId === it.productId)
                const sum = Number(ri?.qty || 0) * Number(plannedItem?.price || 0)
                return (
                  <tr key={it.productId} className="border-t border-line">
                    <td className="py-2 px-3">{it.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted">
                      {num(left?.qty || 0)} {it.unit}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        min="0"
                        max={left?.qty || 0}
                        value={ri?.qty || 0}
                        onChange={(e) => setQty(it.productId, e.target.value)}
                        className="w-20 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">{money(sum)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {(err || !planned.ok) && <div className="text-[13px] text-bad">{err || planned.error}</div>}
      </div>
    </Modal>
  )
}
