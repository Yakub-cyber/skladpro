import { Route as RouteIcon, Check } from 'lucide-react'
import { Badge, Card } from '@/shared/ui'
import WarehouseMap from '@/shared/components/WarehouseMap'
import { useStore } from '@/shared/store/useStore'
import { num, plural } from '@/shared/lib/format'

export default function OrderRoutePanel({ order, route, highlightCells }) {
  return (
    <Card className="p-5 animate-fadeUp">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold flex items-center gap-2">
          <RouteIcon size={17} className="text-brand" /> Маршрут сборщика
        </h4>
        <Badge tone="brand">
          ~{route.distance} м пути · {route.order.length}{' '}
          {plural(route.order.length, 'точка', 'точки', 'точек')}
        </Badge>
      </div>
      <div className="grid md:grid-cols-[1fr_240px] gap-4">
        <div className="rounded-xl border border-line bg-surface-2 p-2">
          <WarehouseMap
            cells={useStore.getState().cells}
            products={useStore.getState().products}
            highlight={highlightCells}
            route={route}
          />
        </div>
        <ol className="space-y-2">
          {route.order.map((c, i) => {
            const it = order.items.find((x) => x.cell === c.id)
            return (
              <li
                key={c.id}
                className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-2"
              >
                <span className="h-6 w-6 shrink-0 rounded-full bg-brand text-white text-[12px] font-semibold grid place-items-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{it?.name}</div>
                  <div className="text-[11px] text-muted">
                    Ячейка {c.id} · {num(it?.qty)} {it?.unit}
                  </div>
                </div>
              </li>
            )
          })}
          <li className="flex items-center gap-2.5 p-2 rounded-lg bg-ok-soft text-ok">
            <span className="h-6 w-6 shrink-0 rounded-full bg-ok text-white grid place-items-center">
              <Check size={13} />
            </span>
            <span className="text-[13px] font-medium">Возврат на выдачу</span>
          </li>
        </ol>
      </div>
    </Card>
  )
}
