import { useRef, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { Button } from '@/shared/ui'
export default function CancellationPanel({ order }) {
  const cancel = useStore(s => s.cancelProtectedOrder), busy = useRef(false)
  const [message, setMessage] = useState('')
  const submit = async () => {
    if (busy.current) return
    const owner = getAuthContext(); busy.current = true
    try {
      const result = await cancel(order.id)
      if (isAuthContextCurrent(owner)) setMessage(result.ok ? 'Отмена сохранена; ожидает сервера. Остатки и долг пока не восстановлены.' : result.error)
    } catch(e) { if (isAuthContextCurrent(owner)) setMessage(e.message) } finally { busy.current = false }
  }
  if (order.status !== 'shipped' && !order.cancellationPending) return null
  return <section className="card p-3 space-y-2" aria-label="Отмена отгрузки">
    {order.cancellationPending ? <p role="status">{order.cancellationPending.needsReview ? 'Отмена требует сверки.' : 'Отмена ожидает подтверждения сервера; товар и долг предварительно не восстановлены.'} {order.cancellationPending.code} {order.cancellationPending.error}</p>
      : <Button onClick={submit} disabled={!!order.deliveryPending || !!order.shipmentPending || !!order.commercialPending}>Отменить отгрузку</Button>}
    {message && !order.cancellationPending && <p role="status">{message}</p>}
  </section>
}
