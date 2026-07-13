// Вкладка «Продажа»: ссылка на кассу + список последних заказов.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ShoppingCart } from 'lucide-react'
import { Card, Button, Badge, Empty } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { money, relTime } from '../../lib/format'
import { statusInfo } from '../../lib/constants'

export default function SaleTab() {
  const nav = useNavigate()
  const orders = useStore((s) => s.orders) || []
  const recent = useMemo(
    () => [...orders].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, 8),
    [orders],
  )
  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Card className="p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2">
          <ShoppingCart size={17} className="text-brand" /> Новая продажа
        </h3>
        <p className="text-[13px] text-muted mb-4">
          Касса: сканируйте или ищите товар, выберите клиента и тип цены. Позиции спишутся со склада,
          а документ попадёт в журнал продаж и смену.
        </p>
        <Button icon={Plus} onClick={() => nav('/orders/new')}>
          Открыть кассу
        </Button>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">Последние продажи</h3>
        {recent.length === 0 ? (
          <Empty icon={ShoppingCart} title="Продаж пока нет" text="Оформите первую через кассу." />
        ) : (
          <div className="divide-y divide-line -mx-1">
            {recent.map((o) => {
              const si = statusInfo(o.status)
              return (
                <button
                  key={o.id}
                  onClick={() => nav(`/orders?id=${o.id}`)}
                  className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-surface-2 rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{o.customerName}</div>
                    <div className="text-[12px] text-muted">{o.no} · {relTime(o.createdAt)}</div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{money(o.total)}</span>
                  <Badge tone={si.color}>{si.label}</Badge>
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
