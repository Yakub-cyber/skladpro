import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Route as RouteIcon } from 'lucide-react'
import { Button, Card, Empty, Modal, StatusBadge } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import OrderDetail from './components/OrderDetail'
import OrdersList from './components/OrdersList'

const isReceipt = (o) => o.kind === 'retail'

export default function Orders() {
  const allOrders = useStore((s) => s.orders)
  const employees = useStore((s) => s.employees)
  const authUserId = useStore((s) => s.authUserId)
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()

  // Начальный фильтр можно задать через URL: /orders?filter=new — так
  // NAV-пункт «Заявки клиентов» ведёт на предфильтрованный список.
  const initialFilter = params.get('filter') || 'all'
  const [filter, setFilter] = useState(initialFilter)
  useEffect(() => {
    const f = params.get('filter')
    if (f && f !== filter) setFilter(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  const [q, setQ] = useState('')

  // Курьер видит только назначенные ему заказы.
  const me = employees.find((e) => e.id === authUserId)
  const isCourier = me?.role === 'courier'
  const orders = useMemo(
    () => (isCourier ? allOrders.filter((o) => o.assignedTo === authUserId) : allOrders),
    [allOrders, isCourier, authUserId],
  )

  // На десктопе — split-view с выбранным по умолчанию первым заказом.
  // На мобиле — стартуем БЕЗ выбранного, чтобы не открывалась модалка
  // деталей автоматически при заходе на страницу.
  const isMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  const urlId = params.get('id')
  const selectedId = urlId || (isMobile ? null : orders[0]?.id)
  const selected = orders.find((o) => o.id === selectedId)

  // Модалка деталей открывается на мобиле только при явном выборе (URL id).
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    if (urlId && isMobile) setDetailOpen(true)
  }, [urlId, isMobile])
  const closeDetail = () => {
    setDetailOpen(false)
    setParams({})
  }

  const list = useMemo(() => {
    return orders.filter((o) => {
      const okF =
        filter === 'all'
          ? true
          : filter === 'orders'
            ? !isReceipt(o)
            : filter === 'receipts'
              ? isReceipt(o)
              : filter === 'active'
                // «Активные» — с Dashboard «Активные заказы» кликом: всё,
                // что ещё в работе. Чеки сюда не попадают — они закрыты
                // в момент пробития.
                ? !isReceipt(o) && !['delivered', 'cancelled'].includes(o.status)
                : filter === 'new'
                  ? !isReceipt(o) && ['new', 'confirmed'].includes(o.status)
                  : filter === 'shipped'
                    ? ['packed', 'shipped'].includes(o.status)
                    : o.status === filter
      const okQ =
        !q ||
        o.no.toLowerCase().includes(q.toLowerCase()) ||
        o.customerName.toLowerCase().includes(q.toLowerCase())
      return okF && okQ
    })
  }, [orders, filter, q])

  const select = (id) => {
    setParams({ id })
    if (isMobile) setDetailOpen(true)
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Заказы</h2>
          <p className="text-sm text-muted">
            {orders.length} всего ·{' '}
            {orders.filter(
              (o) => !isReceipt(o) && ['new', 'confirmed', 'picking'].includes(o.status),
            ).length}{' '}
            в обработке · {orders.filter(isReceipt).length} чеков
          </p>
        </div>
        <Button icon={Plus} onClick={() => nav('/orders/new')}>
          Новый заказ
        </Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-5">
        <OrdersList
          list={list}
          q={q}
          setQ={setQ}
          filter={filter}
          setFilter={setFilter}
          selectedId={selectedId}
          onSelect={select}
        />

        {/* Детали — только на десктопе inline. На мобиле → в модалке. */}
        <div className="hidden lg:block">
          {selected ? (
            <OrderDetail key={selected.id} order={selected} />
          ) : (
            <Card className="grid place-items-center">
              <Empty icon={RouteIcon} title="Выберите заказ" text="Слева — список заказов." />
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={detailOpen && !!selected}
        onClose={closeDetail}
        wide
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{selected.no}</span>
              <StatusBadge status={selected.status} />
            </span>
          ) : (
            'Заказ'
          )
        }
      >
        {selected && <OrderDetail key={selected.id} order={selected} />}
      </Modal>
    </div>
  )
}
