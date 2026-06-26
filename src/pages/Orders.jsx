import { useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Plus,
  Route as RouteIcon,
  Check,
  ChevronRight,
  Link2,
  MapPin,
  Truck,
  X,
  Trash2,
  Search,
  Flag,
  Copy,
} from 'lucide-react'
import {
  Card,
  Button,
  StatusBadge,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Empty,
  cx,
} from '../components/ui'
import WarehouseMap from '../components/WarehouseMap'
import { useStore } from '../store/useStore'
import { money, dateTime, dateShort, plural, num } from '../lib/format'
import {
  TRACK_FLOW,
  statusInfo,
  nextStatus,
  ORDER_STATUSES,
  priceFor,
} from '../lib/constants'
import { buildPickRoute } from '../lib/ai'
import { cellById } from '../store/seed'

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'new', label: 'Новые' },
  { key: 'picking', label: 'Сборка' },
  { key: 'shipped', label: 'В пути' },
  { key: 'delivered', label: 'Доставлены' },
]

export default function Orders() {
  const orders = useStore((s) => s.orders)
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')

  const selectedId = params.get('id') || orders[0]?.id
  const selected = orders.find((o) => o.id === selectedId)

  const list = useMemo(() => {
    return orders.filter((o) => {
      const okF =
        filter === 'all'
          ? true
          : filter === 'new'
            ? ['new', 'confirmed'].includes(o.status)
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

  const select = (id) => setParams({ id })

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Заказы</h2>
          <p className="text-sm text-muted">
            {orders.length} всего ·{' '}
            {orders.filter((o) => ['new', 'confirmed', 'picking'].includes(o.status)).length} в обработке
          </p>
        </div>
        <Button icon={Plus} onClick={() => nav('/orders/new')}>
          Новый заказ
        </Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-5">
        {/* Список */}
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск заказа…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  'px-3 h-8 rounded-lg text-[13px] font-medium whitespace-nowrap transition',
                  filter === f.key
                    ? 'bg-brand text-brand-ink'
                    : 'bg-surface-2 text-muted hover:text-ink',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="space-y-2 max-h-[68vh] overflow-y-auto no-scrollbar pr-0.5">
            {list.map((o) => (
              <button
                key={o.id}
                onClick={() => select(o.id)}
                className={cx(
                  'w-full text-left p-3.5 rounded-xl border transition',
                  o.id === selectedId
                    ? 'border-brand bg-brand-soft'
                    : 'border-line bg-surface hover:border-brand/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm tabular-nums flex items-center gap-1.5">
                    {o.priority && <Flag size={13} className="text-bad" />}
                    {o.no}
                  </span>
                  <StatusBadge status={o.status} />
                </div>
                <div className="text-sm mt-1.5 truncate">{o.customerName}</div>
                <div className="flex items-center justify-between mt-1 text-[12px] text-muted">
                  <span>{dateShort(o.createdAt)}</span>
                  <span className="font-medium text-ink">{money(o.total)}</span>
                </div>
              </button>
            ))}
            {list.length === 0 && (
              <Empty icon={Search} title="Заказы не найдены" />
            )}
          </div>
        </div>

        {/* Детали */}
        {selected ? (
          <OrderDetail key={selected.id} order={selected} />
        ) : (
          <Card className="grid place-items-center">
            <Empty icon={RouteIcon} title="Выберите заказ" text="Слева — список заказов." />
          </Card>
        )}
      </div>
    </div>
  )
}

function OrderDetail({ order }) {
  const advance = useStore((s) => s.advanceOrder)
  const cancel = useStore((s) => s.cancelOrder)
  const [showRoute, setShowRoute] = useState(false)
  const [copied, setCopied] = useState(false)

  const cur = statusInfo(order.status)
  const nx = nextStatus(order.status)
  const nxInfo = nx && statusInfo(nx)

  const route = useMemo(() => {
    const pts = order.items
      .map((it) => cellById(it.cell))
      .filter(Boolean)
      .map((c) => ({ ...c }))
    return buildPickRoute(pts)
  }, [order])

  const highlightCells = order.items.map((it) => it.cell)
  const trackUrl = `${window.location.origin}/track/${order.id}`
  const copyLink = () => {
    navigator.clipboard?.writeText(trackUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold tabular-nums">{order.no}</h3>
              {order.priority && (
                <Badge tone="bad">
                  <Flag size={11} /> Срочный
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted mt-0.5">
              {order.customerName} · {dateTime(order.createdAt)}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {/* Воронка статусов */}
        {order.status !== 'cancelled' ? (
          <div className="mt-5 flex items-center">
            {TRACK_FLOW.map((s, i) => {
              const done = s.step < cur.step
              const here = s.step === cur.step
              return (
                <div key={s.key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={cx(
                        'h-8 w-8 rounded-full grid place-items-center text-[12px] font-semibold transition',
                        done && 'bg-ok text-white',
                        here && 'bg-brand text-white ring-4 ring-brand/20',
                        !done && !here && 'bg-surface-3 text-muted',
                      )}
                    >
                      {done ? <Check size={15} /> : i + 1}
                    </div>
                    <span
                      className={cx(
                        'text-[10px] mt-1 whitespace-nowrap',
                        here ? 'text-ink font-medium' : 'text-muted',
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < TRACK_FLOW.length - 1 && (
                    <div
                      className={cx(
                        'h-0.5 flex-1 mx-1 -mt-4 rounded',
                        s.step < cur.step ? 'bg-ok' : 'bg-surface-3',
                      )}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-bad-soft text-bad text-sm font-medium">
            Заказ отменён
          </div>
        )}

        {/* Действия */}
        <div className="flex flex-wrap gap-2 mt-5">
          {nx && (
            <Button icon={ChevronRight} onClick={() => advance(order.id)}>
              {cur.step === 1 ? 'Начать сборку' : `В статус «${nxInfo.label}»`}
            </Button>
          )}
          <Button
            variant="soft"
            icon={RouteIcon}
            onClick={() => setShowRoute((v) => !v)}
          >
            {showRoute ? 'Скрыть маршрут' : 'Маршрут сборки'}
          </Button>
          <Button variant="soft" icon={copied ? Check : Link2} onClick={copyLink}>
            {copied ? 'Скопировано' : 'Ссылка клиенту'}
          </Button>
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <Button
              variant="ghost"
              icon={X}
              className="text-bad"
              onClick={() => cancel(order.id)}
            >
              Отменить
            </Button>
          )}
        </div>
      </Card>

      {/* Маршрут сборки */}
      {showRoute && (
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
                      <div className="text-[13px] font-medium truncate">
                        {it?.name}
                      </div>
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
      )}

      {/* Позиции */}
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
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-line text-sm">
          <span className="flex items-center gap-2 text-muted">
            <Truck size={15} /> {order.courier}
          </span>
          <span className="flex items-center gap-2 text-muted">
            <MapPin size={15} /> {order.address}
          </span>
        </div>
      </Card>
    </div>
  )
}
