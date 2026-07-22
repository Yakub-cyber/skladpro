// Дашборд для роли «курьер». В отличие от менеджерского — очень компактный:
// у курьера основной экран это «Мой маршрут» (/delivery), а /dashboard
// используется как «главная страница смены»: приветствие + текущая точка
// + быстрый переход к маршруту.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MapPin, Navigation, PhoneCall, Route } from 'lucide-react'
import { Card, Button, Badge, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { plural, money } from '../lib/format'

export default function DashboardCourier() {
  const orders = useStore((s) => s.orders) || []
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)

  // «Мой маршрут» — заказы, назначенные текущему курьеру и не завершённые.
  const myRoute = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.courierId === authUserId &&
          ['packed', 'shipped', 'picking'].includes(o.status),
      ),
    [orders, authUserId],
  )
  const done = useMemo(
    () =>
      orders.filter(
        (o) => o.courierId === authUserId && o.status === 'delivered',
      ).length,
    [orders, authUserId],
  )
  const total = myRoute.length + done
  const percent = total ? Math.round((done / total) * 100) : 0
  const next = myRoute[0]

  return (
    <div className="animate-fadeUp space-y-5 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {me?.name?.split(' ')[0] || 'Курьер'}, добро пожаловать
        </h2>
        <p className="text-[13px] text-muted mt-1">
          {total
            ? `Сегодня ${total} ${plural(total, ['доставка', 'доставки', 'доставок'])} · выполнено ${done}`
            : 'Активных доставок пока нет — ждём, пока менеджер назначит.'}
        </p>
      </div>

      {/* Прогресс маршрута */}
      {total > 0 && (
        <Card className="p-5 bg-brand text-brand-ink shadow-lg shadow-brand/30">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wide opacity-80 font-semibold">
                Прогресс дня
              </div>
              <div className="text-[22px] font-semibold leading-tight mt-1 tracking-tight">
                {done} из {total}
              </div>
              <div className="text-[12.5px] opacity-90 mt-1">
                осталось {myRoute.length}
              </div>
            </div>
            <div className="w-16 h-16 rounded-full grid place-items-center relative shrink-0">
              <svg width="64" height="64" viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
                <circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.25)" strokeWidth="4" fill="none" />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="#fff"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 28}
                  strokeDashoffset={2 * Math.PI * 28 * (1 - percent / 100)}
                />
              </svg>
              <span className="text-[14px] font-bold z-10">{percent}%</span>
            </div>
          </div>
        </Card>
      )}

      {/* Следующая точка (если есть) */}
      {next && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-xl bg-brand-soft text-brand grid place-items-center shrink-0">
              <MapPin size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
                Следующая точка
              </div>
              <div className="text-[16px] font-semibold text-ink mt-1 tracking-tight truncate">
                {next.address || next.customerName || 'Клиент'}
              </div>
              {next.customerName && next.address && (
                <div className="text-[12.5px] text-muted mt-0.5 truncate">
                  {next.customerName} · {(next.items || []).length}{' '}
                  {plural((next.items || []).length, ['позиция', 'позиции', 'позиций'])}
                  {next.total ? ` · ${money(next.total)}` : ''}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Link to="/delivery" className="flex-1 min-w-[140px]">
              <Button icon={Navigation} className="w-full">
                Открыть маршрут
              </Button>
            </Link>
            {next.customerPhone && (
              <a href={`tel:${next.customerPhone}`} className="flex-1 min-w-[140px]">
                <Button variant="soft" icon={PhoneCall} className="w-full">
                  Позвонить
                </Button>
              </a>
            )}
          </div>
        </Card>
      )}

      {/* Пустое состояние */}
      {!next && (
        <Card className="p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-surface-2 grid place-items-center text-muted mb-3">
            <Route size={22} />
          </div>
          <p className="font-medium">Маршрут ещё не назначен</p>
          <p className="text-[13px] text-muted mt-1 max-w-xs mx-auto">
            Когда менеджер прикрепит заказ на вас, он появится здесь и в разделе «Мой маршрут».
          </p>
          <Link to="/delivery" className="inline-block mt-4">
            <Button variant="soft" icon={ArrowRight}>
              Открыть доставку
            </Button>
          </Link>
        </Card>
      )}
    </div>
  )
}
