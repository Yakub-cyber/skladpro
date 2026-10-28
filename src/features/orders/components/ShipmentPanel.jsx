import { useRef, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { shipmentConditions } from '@/shared/lib/shipmentV2'
import SaleWarehouse from '@/shared/components/SaleWarehouse'
export default function ShipmentPanel({ order }) {
  const [warehouseId, setWarehouseId] = useState(''), [message, setMessage] = useState('')
  const busy = useRef(false)
  const prepare = useStore(s => s.prepareShipment), ship = useStore(s => s.shipOrder)
  const problem = order.commercialPending ? 'Сначала подтвердите коммерческий состав заказа' : shipmentConditions(order.commercialSnapshot)
  const run = async action => {
    if (busy.current) return
    busy.current = true
    try { const r = await action(); setMessage(r.ok ? 'Команда принята; состояние сервера проверяется отдельно' : r.error) }
    catch(e) { setMessage(e.message) } finally { busy.current = false }
  }
  return <section className="card p-3 space-y-2" aria-label="Отгрузка заказа">
    <div className="font-medium">Отгрузка заказа</div>
    {order.shipmentPending ? <p role="status">Отгрузка сохранена локально; ожидает подтверждения. {order.shipmentPending.code} {order.shipmentPending.error}</p>
      : order.stockConsumed || order.shipmentDocId ? <p>Отгрузка подтверждена сервером. Доставка не списывает товар повторно.</p>
        : problem ? <p role="status">{problem}</p>
          : ['new', 'confirmed'].includes(order.status) ? <button className="btn" onClick={() => run(() => prepare(order.id))}>Подготовить к отгрузке онлайн</button>
            : ['picking', 'packed'].includes(order.status) ? <>
              <SaleWarehouse label="Склад отгрузки" value={warehouseId} onChange={setWarehouseId} items={order.items} />
              <button className="btn" disabled={!warehouseId} onClick={() => run(() => ship(order.id, warehouseId))}>Отгрузить заказ</button>
            </> : <p>Отгрузка недоступна в текущем состоянии заказа</p>}
    {(order.shipmentPending || order.stockConsumed) && <SaleWarehouse label="Склад отгрузки" value={order.shipmentPending?.warehouseId || order.shipmentWarehouseId || ''} onChange={setWarehouseId} items={order.items} disabled />}
    {message && <p role="status">{message}</p>}
  </section>
}
