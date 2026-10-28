import { useRef, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { Button } from '@/shared/ui'
export default function DeliveryPanel({ order }) {
  const deliver = useStore(s => s.deliverOrder), busy = useRef(false)
  const [message, setMessage] = useState('')
  const submit = async () => {
    if (busy.current) return
    const owner = getAuthContext(); busy.current = true
    try {
      const result = await deliver(order.id)
      if (isAuthContextCurrent(owner)) setMessage(result.ok ? 'Доставка сохранена на устройстве; ожидает подтверждения сервера' : result.error)
    } catch(e) { if (isAuthContextCurrent(owner)) setMessage(e.message) } finally { busy.current = false }
  }
  if (order.status !== 'shipped' && order.status !== 'delivered' && !order.deliveryPending) return null
  return <section className="card p-3 space-y-2" aria-label="Доставка заказа">
    {order.deliveryPending ? <p role="status">{order.deliveryPending.needsReview ? 'Доставка требует сверки.' : 'Доставка ожидает подтверждения сервера.'} {order.deliveryPending.code} {order.deliveryPending.error}</p>
      : order.status === 'delivered' ? <p role="status">Доставка подтверждена сервером</p>
        : <Button onClick={submit} disabled={!!order.cancellationPending || !!order.shipmentPending || !!order.commercialPending}>Отметить доставленным</Button>}
    {message && !order.deliveryPending && order.status !== 'delivered' && <p role="status">{message}</p>}
  </section>
}
