import { MapPin, Truck } from 'lucide-react'
import { Badge, Card } from '@/shared/ui'
import { money, num, plural } from '@/shared/lib/format'

export default function OrderItemsTable({ order, canAssign, couriers, onAssignCourier }) {
  return (
    <Card className="p-5">
      <h4 className="font-semibold mb-3">
        Состав заказа · {order.items.length}{' '}
        {plural(order.items.length, 'позиция', 'позиции', 'позиций')}
      </h4>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-[12px] text-left border-b border-line">
              <th className="font-medium pb-2 px-1">Товар</th>
              <th className="font-medium pb-2 px-1">Ячейка</th>
              <th className="font-medium pb-2 px-1 text-right">Кол-во</th>
              <th className="font-medium pb-2 px-1 text-right">Цена</th>
              <th className="font-medium pb-2 px-1 text-right">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.items.map((it, i) => (
              <tr key={i}>
                <td className="py-2.5 px-1">{it.name}</td>
                <td className="py-2.5 px-1">
                  <Badge tone="muted">
                    <MapPin size={11} /> {it.cell}
                  </Badge>
                </td>
                <td className="py-2.5 px-1 text-right tabular-nums">
                  {num(it.qty)} {it.unit}
                </td>
                <td className="py-2.5 px-1 text-right tabular-nums text-muted">
                  {money(it.price)}
                </td>
                <td className="py-2.5 px-1 text-right tabular-nums font-medium">
                  {money(it.qty * it.price)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={4} className="pt-3 px-1 text-right text-muted">
                Итого
              </td>
              <td className="pt-3 px-1 text-right font-semibold text-base tabular-nums">
                {money(order.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-line text-sm">
        <span className="flex items-center gap-2 text-muted">
          <Truck size={15} /> {order.courier}
        </span>
        <span className="flex items-center gap-2 text-muted">
          <MapPin size={15} /> {order.address}
        </span>
        {canAssign && couriers.length > 0 && (
          <label className="flex items-center gap-2 ml-auto text-muted">
            <Truck size={15} className="text-brand" />
            <span className="text-[13px]">Курьер:</span>
            <select
              value={order.assignedTo || ''}
              onChange={(e) => onAssignCourier(order.id, e.target.value || null)}
              className="h-9 px-2 rounded-lg bg-surface-2 border border-line text-[13px] outline-none focus:border-brand"
            >
              <option value="">— не назначен —</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </Card>
  )
}
