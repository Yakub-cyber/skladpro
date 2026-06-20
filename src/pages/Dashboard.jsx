import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet,
  ClipboardList,
  AlertTriangle,
  Users,
  PackageMinus,
  TrendingDown,
  Flame,
  Snowflake,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Stat, Card, Section, StatusBadge, Badge, Progress, Button } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateShort, plural } from '../lib/format'
import { analyticsInsights, soldByProduct } from '../lib/ai'
import { catInfo } from '../lib/constants'

const INSIGHT_ICON = { PackageMinus, TrendingDown, Flame, Snowflake }
const SEV = {
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
}

export default function Dashboard() {
  const { products, orders, customers } = useStore()

  const m = useMemo(() => {
    const active = orders.filter((o) =>
      ['new', 'confirmed', 'picking', 'packed', 'shipped'].includes(o.status),
    )
    const valid = orders.filter((o) => o.status !== 'cancelled')
    const revenue = valid.reduce((a, o) => a + o.total, 0)
    const low = products.filter((p) => p.stock <= p.minStock)
    const avg = valid.length ? revenue / valid.length : 0

    // выручка по дням (14 дней)
    const days = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const sum = valid
        .filter((o) => o.createdAt.slice(0, 10) === key)
        .reduce((a, o) => a + o.total, 0)
      days.push({ label: dateShort(d.toISOString()), v: sum })
    }
    const firstHalf = days.slice(0, 7).reduce((a, d) => a + d.v, 0)
    const secondHalf = days.slice(7).reduce((a, d) => a + d.v, 0)
    // тренд показываем только при значимой базе, иначе проценты улетают в тысячи
    const trend =
      firstHalf > 5000
        ? Math.max(-95, Math.min(99, Math.round(((secondHalf - firstHalf) / firstHalf) * 100)))
        : null

    // топ товары
    const sold = soldByProduct(orders)
    const top = Object.entries(sold)
      .map(([id, q]) => ({ p: products.find((x) => x.id === id), q }))
      .filter((x) => x.p)
      .sort((a, b) => b.q - a.q)
      .slice(0, 5)
    const maxQ = top[0]?.q || 1

    return { active, revenue, low, avg, days, trend, top, maxQ }
  }, [products, orders])

  const insights = useMemo(
    () => analyticsInsights({ products, orders }),
    [products, orders],
  )
  const stockValue = products.reduce((a, p) => a + p.stock * p.cost, 0)

  return (
    <div className="space-y-5 animate-fadeUp">
      {/* KPI */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Выручка за месяц"
          value={money(m.revenue)}
          icon={Wallet}
          tone="brand"
          trend={m.trend}
        />
        <Stat
          label="Активные заказы"
          value={num(m.active.length)}
          sub={`в работе на ${money(m.active.reduce((a, o) => a + o.total, 0))}`}
          icon={ClipboardList}
          tone="info"
        />
        <Stat
          label="Ниже минимума"
          value={num(m.low.length)}
          sub="требуют закупки"
          icon={AlertTriangle}
          tone={m.low.length ? 'bad' : 'ok'}
        />
        <Stat
          label="Клиентов"
          value={num(customers.length)}
          sub={`средний чек ${money(m.avg)}`}
          icon={Users}
          tone="ok"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* График выручки */}
        <Section
          className="lg:col-span-2"
          title="Выручка, 14 дней"
          subtitle={`Стоимость склада в закупке: ${money(stockValue)}`}
        >
          <div className="h-[260px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.days} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}к` : v)}
                />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--brand)' }} />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="var(--brand)"
                  strokeWidth={2.5}
                  fill="url(#rev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Section>

        {/* ИИ-инсайты */}
        <Section
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={16} className="text-brand" /> ИИ-аналитика
            </span>
          }
        >
          <div className="space-y-3">
            {insights.length === 0 && (
              <p className="text-sm text-muted">Всё спокойно — рисков не обнаружено.</p>
            )}
            {insights.map((ins) => {
              const Icon = INSIGHT_ICON[ins.icon] || Sparkles
              return (
                <div
                  key={ins.id}
                  className="flex gap-3 p-3 rounded-xl bg-surface-2 border border-line"
                >
                  <div
                    className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${SEV[ins.severity]}`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-snug">{ins.title}</p>
                    <p className="text-[12px] text-muted mt-0.5 leading-relaxed">
                      {ins.text}
                    </p>
                    {ins.action && (
                      <Link
                        to={ins.action.to}
                        className="text-[12px] text-brand font-medium inline-flex items-center gap-1 mt-1.5 hover:gap-2 transition-all"
                      >
                        {ins.action.label} <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Последние заказы */}
        <Section
          className="lg:col-span-2"
          title="Последние заказы"
          action={
            <Link to="/orders">
              <Button variant="ghost" size="sm">
                Все заказы <ArrowRight size={14} />
              </Button>
            </Link>
          }
        >
          <div className="divide-y divide-line -mx-1">
            {orders.slice(0, 6).map((o) => (
              <Link
                key={o.id}
                to={`/orders?id=${o.id}`}
                className="flex items-center gap-3 py-2.5 px-1 hover:bg-surface-2 rounded-lg transition"
              >
                <div className="font-medium text-sm w-28 shrink-0 tabular-nums">
                  {o.no}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{o.customerName}</div>
                  <div className="text-[12px] text-muted">
                    {o.items.length} {plural(o.items.length, 'позиция', 'позиции', 'позиций')} ·{' '}
                    {dateShort(o.createdAt)}
                  </div>
                </div>
                <div className="text-sm font-medium tabular-nums hidden sm:block">
                  {money(o.total)}
                </div>
                <StatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        </Section>

        {/* Топ продаж */}
        <Section title="Топ продаж за месяц">
          <div className="space-y-3.5">
            {m.top.map(({ p, q }) => {
              const c = catInfo(p.category)
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="truncate pr-2">{p.name}</span>
                    <span className="text-muted shrink-0 tabular-nums">
                      {num(q)} {p.unit}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(q / m.maxQ) * 100}%`,
                        background: c.color,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      </div>
    </div>
  )
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="card px-3 py-2 text-sm shadow-lg">
      <div className="text-muted text-[12px]">{label}</div>
      <div className="font-semibold">{money(payload[0].value)}</div>
    </div>
  )
}
