import { useParams, Link } from 'react-router-dom'
import {
  Boxes,
  FileText,
  CheckCircle2,
  PackageSearch,
  Package,
  Truck,
  PartyPopper,
  MapPin,
  Phone,
  XCircle,
  Clock,
} from 'lucide-react'
import { Badge, Card, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateTime, dateFull } from '../lib/format'
import { TRACK_FLOW, statusInfo } from '../lib/constants'

const STEP_ICON = {
  new: FileText,
  confirmed: CheckCircle2,
  picking: PackageSearch,
  packed: Package,
  shipped: Truck,
  delivered: PartyPopper,
}
const STEP_TEXT = {
  new: 'Заказ принят и зарегистрирован',
  confirmed: 'Заказ подтверждён менеджером',
  picking: 'Товар собирается на складе',
  packed: 'Заказ собран и упакован',
  shipped: 'Передан в доставку, едет к вам',
  delivered: 'Заказ доставлен. Спасибо!',
}

export default function Tracking() {
  const { id } = useParams()
  const order = useStore((s) => s.orders.find((o) => o.id === id))
  const company = useStore((s) => s.settings.company)

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Шапка */}
      <header className="h-16 border-b border-line flex items-center px-5 sticky top-0 bg-bg/90 backdrop-blur z-10">
        <div className="flex items-center gap-2.5 max-w-2xl mx-auto w-full">
          <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink">
            <Boxes size={20} />
          </div>
          <div className="font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
          <span className="text-muted text-sm ml-2 hidden sm:block">
            · отслеживание заказа
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {!order ? (
          <Card className="p-10 text-center">
            <XCircle size={40} className="text-muted mx-auto mb-3" />
            <h2 className="text-lg font-semibold">Заказ не найден</h2>
            <p className="text-muted text-sm mt-1">
              Проверьте ссылку — возможно, она устарела.
            </p>
            <Link to="/" className="text-brand text-sm font-medium mt-4 inline-block">
              На главную
            </Link>
          </Card>
        ) : (
          <OrderTrack order={order} company={company} />
        )}
      </main>
    </div>
  )
}

function OrderTrack({ order, company }) {
  const cur = statusInfo(order.status)
  const cancelled = order.status === 'cancelled'
  const trackMap = (order.track || []).reduce((m, t) => {
    m[t.status] = t.at
    return m
  }, {})

  // ожидаемая доставка
  const eta = new Date(order.createdAt)
  eta.setDate(eta.getDate() + 3)

  return (
    <div className="animate-fadeUp space-y-5">
      {/* Текущий статус */}
      <Card className="p-6 text-center">
        <div className="text-sm text-muted">Заказ {order.no}</div>
        {cancelled ? (
          <>
            <div className="h-16 w-16 rounded-2xl bg-bad-soft text-bad grid place-items-center mx-auto my-3">
              <XCircle size={32} />
            </div>
            <h1 className="text-xl font-semibold">Заказ отменён</h1>
          </>
        ) : (
          <>
            <div className="h-16 w-16 rounded-2xl bg-brand-soft text-brand grid place-items-center mx-auto my-3">
              {(() => {
                const Icon = STEP_ICON[order.status] || Package
                return <Icon size={32} />
              })()}
            </div>
            <h1 className="text-xl font-semibold">{cur.label}</h1>
            <p className="text-muted text-sm mt-1">{STEP_TEXT[order.status]}</p>
            {order.status !== 'delivered' && (
              <Badge tone="info" className="mt-3">
                <Clock size={12} /> Ожидаемая доставка: {dateFull(eta.toISOString())}
              </Badge>
            )}
          </>
        )}
      </Card>

      {/* Таймлайн */}
      {!cancelled && (
        <Card className="p-6">
          <div className="space-y-0">
            {TRACK_FLOW.map((s, i) => {
              const done = s.step < cur.step
              const here = s.step === cur.step
              const Icon = STEP_ICON[s.key]
              const at = trackMap[s.key]
              const last = i === TRACK_FLOW.length - 1
              return (
                <div key={s.key} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={cx(
                        'h-10 w-10 rounded-full grid place-items-center shrink-0 transition',
                        done && 'bg-ok text-white',
                        here && 'bg-brand text-white ring-4 ring-brand/20',
                        !done && !here && 'bg-surface-2 text-muted',
                      )}
                    >
                      <Icon size={18} />
                    </div>
                    {!last && (
                      <div
                        className={cx(
                          'w-0.5 flex-1 min-h-[28px] my-1',
                          done ? 'bg-ok' : 'bg-surface-3',
                        )}
                      />
                    )}
                  </div>
                  <div className={cx('pb-6 pt-1.5', last && 'pb-0')}>
                    <div
                      className={cx(
                        'font-medium text-sm',
                        here ? 'text-ink' : done ? 'text-ink' : 'text-muted',
                      )}
                    >
                      {s.label}
                    </div>
                    <div className="text-[12px] text-muted mt-0.5">
                      {at ? dateTime(at) : 'ожидается'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Состав */}
      <Card className="p-6">
        <h3 className="font-semibold mb-3">Состав заказа</h3>
        <div className="divide-y divide-line">
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 text-sm">
              <span className="flex-1 min-w-0 truncate pr-2">{it.name}</span>
              <span className="text-muted tabular-nums mr-4">
                {num(it.qty)} {it.unit}
              </span>
              <span className="font-medium tabular-nums">{money(it.qty * it.price)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-3 mt-1 border-t border-line">
          <span className="text-muted text-sm">Итого</span>
          <span className="text-lg font-semibold tabular-nums">{money(order.total)}</span>
        </div>
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-line text-sm text-muted">
          <span className="flex items-center gap-2">
            <Truck size={15} /> {order.courier}
          </span>
          <span className="flex items-center gap-2">
            <MapPin size={15} /> {order.address}
          </span>
        </div>
      </Card>

      <p className="text-center text-[12px] text-muted">
        Вопросы по заказу? Свяжитесь с {company}.
      </p>
    </div>
  )
}
