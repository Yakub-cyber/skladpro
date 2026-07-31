import { plural } from '@/shared/lib/format'

// Контекст-плитка над nav: для stock — «Смена открыта · Xч Yм · принято N»,
// для courier — «Маршрут · X из Y точек». Даёт роли ощущение «это моя
// смена, а не общий сайт». Для manager/admin плитку не показываем.
export default function ShiftContextTile({ me, orders, documents, authAt }) {
  if (me?.role !== 'stock' && me?.role !== 'courier') return null

  if (me.role === 'stock') {
    if (!authAt) return null
    const ms = Date.now() - authAt
    const h = Math.floor(ms / 3_600_000)
    const min = Math.floor((ms % 3_600_000) / 60_000)
    const dur = h ? `${h}ч ${min}м` : `${min}м`
    const accepted = documents.filter(
      (d) => d.by === me.id && d.type === 'purchase' && d.status === 'posted' && d.createdAt >= authAt,
    ).length
    return (
      <div className="mx-3 mb-2 rounded-xl bg-ok-soft border border-ok/25 px-3 py-2.5">
        <div className="text-[10px] font-semibold text-ok uppercase tracking-wide">
          Смена · {dur}
        </div>
        <div className="text-[12.5px] text-ink mt-0.5">
          Принято сегодня: <b>{accepted}</b>
        </div>
      </div>
    )
  }

  // courier
  const myRoute = orders.filter(
    (o) => o.courierId === me.id && ['packed', 'shipped', 'picking'].includes(o.status),
  )
  const done = orders.filter(
    (o) => o.courierId === me.id && o.status === 'delivered',
  ).length
  const total = myRoute.length + done
  if (!total) return null
  return (
    <div className="mx-3 mb-2 rounded-xl bg-warn-soft border border-warn/25 px-3 py-2.5">
      <div className="text-[10px] font-semibold text-warn uppercase tracking-wide">
        Маршрут · {done}/{total}
      </div>
      <div className="text-[12.5px] text-ink mt-0.5">
        Осталось {myRoute.length} {plural(myRoute.length, ['точка', 'точки', 'точек'])}
      </div>
    </div>
  )
}
