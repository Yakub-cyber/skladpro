import { useMemo, useState } from 'react'
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
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Stat, Card, Section, StatusBadge, Badge, Progress, Button, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateShort, plural } from '../lib/format'
import { analyticsInsights, soldByProduct } from '../lib/ai'
import { reservedByProduct, availableStock } from '../lib/orders'
import { catInfo } from '../lib/constants'
import DashboardStock from './DashboardStock'
import DashboardCourier from './DashboardCourier'

const INSIGHT_ICON = { PackageMinus, TrendingDown, Flame, Snowflake }
const SEV = {
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
}

const PERIODS = [
  { key: 'day', label: 'День' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
]

// Метрики финансового графика. Выручка/себестоимость/прибыль — на левой
// оси Y (одинаковый масштаб в рублях), средний чек — на правой (он на
// пару порядков меньше суммарной выручки, слил бы с осью).
const METRICS = [
  { key: 'revenue', label: 'Выручка', color: 'var(--brand)', axis: 'left', fill: true },
  { key: 'cost', label: 'Себестоимость', color: '#f97316', axis: 'left' },
  { key: 'profit', label: 'Прибыль', color: '#10b981', axis: 'left' },
  { key: 'avg', label: 'Средний чек', color: '#8b5cf6', axis: 'right' },
]

// Дашборд-router: по роли текущего сотрудника рендерит нужный вариант.
// Менеджер/админ — DashboardManager (финансы, KPI, аналитика). Кладовщик —
// DashboardStock (приёмка, сборка, ниже минимума). Курьер — DashboardCourier
// (прогресс маршрута + следующая точка).
export default function Dashboard() {
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  if (me?.role === 'stock') return <DashboardStock />
  if (me?.role === 'courier') return <DashboardCourier />
  return <DashboardManager />
}

function DashboardManager() {
  const { products, orders, customers } = useStore()
  const [period, setPeriod] = useState('month')
  // Активные метрики графика (клик по чипу — тумблер). Default: все 4.
  const [activeMetrics, setActiveMetrics] = useState(() => new Set(METRICS.map((x) => x.key)))
  const toggleMetric = (key) =>
    setActiveMetrics((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // не даём выключить последнюю — иначе график пустой
      return next.size ? next : new Set([key])
    })

  const m = useMemo(() => {
    const active = orders.filter((o) =>
      ['new', 'confirmed', 'picking', 'packed', 'shipped'].includes(o.status),
    )
    const valid = orders.filter((o) => o.status !== 'cancelled')
    const revenue = valid.reduce((a, o) => a + o.total, 0)
    // «Ниже минимума» — по доступному (остаток − резерв открытых заказов)
    const reserved = reservedByProduct(orders)
    const low = products.filter((p) => availableStock(p, reserved) <= p.minStock)
    const avg = valid.length ? revenue / valid.length : 0

    const sold = soldByProduct(orders)
    const top = Object.entries(sold)
      .map(([id, q]) => ({ p: products.find((x) => x.id === id), q }))
      .filter((x) => x.p)
      .sort((a, b) => b.q - a.q)
      .slice(0, 5)
    const maxQ = top[0]?.q || 1

    return { active, revenue, low, avg, top, maxQ }
  }, [products, orders])

  // Карта id→cost для оценки себестоимости продаж (COGS). Для точной
  // FIFO-COGS нужно было бы фиксировать item.cost на отгрузке; пока
  // прагматично — текущая средневзвешенная cost продукта.
  const costMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, Number(p.cost) || 0])),
    [products],
  )
  const chart = useMemo(() => buildSeries(period, orders, costMap), [period, orders, costMap])

  const insights = useMemo(() => analyticsInsights({ products, orders }), [products, orders])
  const stockValue = products.reduce((a, p) => a + p.stock * p.cost, 0)
  const debt = customers.reduce((a, c) => a + (c.balance || 0), 0)

  return (
    <div className="space-y-5 animate-fadeUp">
      {/* KPI */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Выручка за месяц"
          value={money(m.revenue)}
          icon={Wallet}
          tone="brand"
          trend={chart.trend}
          to="/analytics"
        />
        <Stat
          label="Активные заказы"
          value={num(m.active.length)}
          sub={`в работе на ${money(m.active.reduce((a, o) => a + o.total, 0))}`}
          icon={ClipboardList}
          tone="info"
          to="/orders?filter=active"
        />
        <Stat
          label="Ниже минимума"
          value={num(m.low.length)}
          sub="требуют закупки"
          icon={AlertTriangle}
          tone={m.low.length ? 'bad' : 'ok'}
          to="/products?stockStatus=low"
        />
        <Stat
          label="Клиентов"
          value={num(customers.length)}
          sub={debt > 0 ? `дебиторка ${money(debt)}` : `средний чек ${money(m.avg)}`}
          icon={Users}
          tone={debt > 0 ? 'warn' : 'ok'}
          to="/customers"
        />
      </div>

      {/* Оценка склада (виджет по образцу CloudShop) — сразу под KPI,
          чтобы проблемы (себестоимость=0, отрицательный остаток) читались
          первым экраном. */}
      <StockValuationSection products={products} />

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Финансовый график: выручка/себестоимость/прибыль (левая ось) +
            средний чек (правая ось). Метрики — тумблеры-чипы. */}
        <Section
          className="lg:col-span-2"
          title="Финансы"
          subtitle={`${chart.periodLabel} · склад в закупке ${money(stockValue)}`}
          action={
            <div className="flex gap-0.5 bg-surface-2 rounded-lg p-0.5 overflow-x-auto no-scrollbar">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={cx(
                    'px-2.5 h-7 rounded-md text-[12px] font-medium transition whitespace-nowrap',
                    period === p.key ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
        >
          {/* Тумблеры метрик — цвет чипа = цвет линии. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {METRICS.map((mm) => {
              const active = activeMetrics.has(mm.key)
              return (
                <button
                  key={mm.key}
                  onClick={() => toggleMetric(mm.key)}
                  className={cx(
                    'inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[12px] font-medium border transition',
                    active
                      ? 'bg-surface-2 border-line text-ink'
                      : 'bg-transparent border-line text-muted hover:text-ink',
                  )}
                  style={active ? { boxShadow: `inset 0 -2px 0 ${mm.color}` } : undefined}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: mm.color, opacity: active ? 1 : 0.35 }}
                  />
                  {mm.label}
                </button>
              )
            })}
          </div>
          <div className="h-[260px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart.series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}к` : v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}к` : v)}
                />
                <Tooltip
                  content={<ChartTip activeKeys={activeMetrics} />}
                  cursor={{ stroke: 'var(--brand)', strokeOpacity: 0.35 }}
                />
                {activeMetrics.has('revenue') && (
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    name="Выручка"
                    stroke="var(--brand)"
                    strokeWidth={2.5}
                    fill="url(#rev)"
                  />
                )}
                {activeMetrics.has('cost') && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cost"
                    name="Себестоимость"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                  />
                )}
                {activeMetrics.has('profit') && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="profit"
                    name="Прибыль"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                )}
                {activeMetrics.has('avg') && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avg"
                    name="Средний чек"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                )}
              </ComposedChart>
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
                    <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{ins.text}</p>
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
                <div className="font-medium text-sm w-28 shrink-0 tabular-nums">{o.no}</div>
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

function ChartTip({ active, payload, label, activeKeys }) {
  if (!active || !payload?.length) return null
  // Показываем в тултипе только активные метрики; порядок = METRICS.
  const map = Object.fromEntries(payload.map((x) => [x.dataKey, x]))
  return (
    <div className="card px-3 py-2 text-sm shadow-lg min-w-[160px]">
      <div className="text-muted text-[12px] mb-1">{label}</div>
      <div className="space-y-1">
        {METRICS.filter((mm) => !activeKeys || activeKeys.has(mm.key)).map((mm) => {
          const p = map[mm.key]
          if (!p) return null
          return (
            <div key={mm.key} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: mm.color }}
                />
                {mm.label}
              </span>
              <span className="font-semibold tabular-nums">{money(p.value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Прирост второй половины периода к первой (для KPI «Выручка за месяц»).
function trendOf(series) {
  const h = Math.floor(series.length / 2)
  const first = series.slice(0, h).reduce((a, d) => a + (d.revenue || 0), 0)
  const second = series.slice(h).reduce((a, d) => a + (d.revenue || 0), 0)
  if (first < 1000) return null
  return Math.max(-95, Math.min(99, Math.round(((second - first) / first) * 100)))
}

// Агрегация 4 метрик по бакетам периода.
// bucket: { label, revenue, cost, profit, avg, count }
function buildSeries(period, orders, costMap = {}) {
  const valid = orders.filter((o) => o.status !== 'cancelled')

  // Себестоимость строки заказа = qty × current cost из costMap.
  // Прагматично; для точной FIFO-COGS нужно фиксировать item.cost при отгрузке.
  const orderCogs = (o) =>
    (o.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (costMap[it.productId] || 0), 0)

  const aggIn = (from, to) => {
    let revenue = 0
    let cost = 0
    let count = 0
    for (const o of valid) {
      const t = new Date(o.createdAt).getTime()
      if (t < from || t >= to) continue
      revenue += Number(o.total) || 0
      cost += orderCogs(o)
      count += 1
    }
    return {
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      profit: Math.round(revenue - cost),
      avg: count ? Math.round(revenue / count) : 0,
      count,
    }
  }

  const now = new Date()
  const DAY = 86400000
  const ddmm = (d) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })

  const wrap = (buckets, periodLabel) => ({
    series: buckets,
    trend: trendOf(buckets),
    periodLabel,
  })

  if (period === 'day') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const series = Array.from({ length: 24 }, (_, h) => {
      const from = start.getTime() + h * 3600000
      return { label: `${String(h).padStart(2, '0')}:00`, ...aggIn(from, from + 3600000) }
    })
    return wrap(series, 'сегодня, по часам')
  }
  if (period === 'week' || period === 'month') {
    const n = period === 'week' ? 7 : 30
    const d0 = new Date(now)
    d0.setHours(0, 0, 0, 0)
    const series = []
    for (let i = n - 1; i >= 0; i--) {
      const day = new Date(d0)
      day.setDate(day.getDate() - i)
      const from = day.getTime()
      series.push({ label: ddmm(day), ...aggIn(from, from + DAY) })
    }
    return wrap(series, `${n} дней`)
  }
  if (period === 'quarter') {
    const d0 = new Date(now)
    d0.setHours(0, 0, 0, 0)
    const series = []
    for (let i = 12; i >= 0; i--) {
      const from = d0.getTime() - i * 7 * DAY
      series.push({ label: ddmm(new Date(from)), ...aggIn(from, from + 7 * DAY) })
    }
    return wrap(series, '13 недель')
  }
  // year — 12 месяцев
  const series = []
  for (let i = 11; i >= 0; i--) {
    const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mNext = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    series.push({
      label: mStart.toLocaleDateString('ru-RU', { month: 'short' }),
      ...aggIn(mStart.getTime(), mNext.getTime()),
    })
  }
  return wrap(series, '12 месяцев')
}

// «Оценка склада» — виджет по образцу CloudShop. Две плашки-внимания
// (себестоимость=0 / отрицательный остаток) с прямыми ссылками на
// проблемные товары; и две карточки-сводки (Общая + По магазину).
// «Магазин» — WAREHOUSES[1] если задан, иначе WAREHOUSES[0]. Все цифры
// считаются от products (без запросов к серверу).
function StockValuationSection({ products }) {
  const warehouses = useStore((s) => s.warehouses) || []
  const stockValuation = useMemo(() => {
    // Считаем только физические товары (не услуги/комплекты — у kit
    // остаток вычисляется на лету, у услуги остатка нет).
    const goods = products.filter((p) => (p.type || 'product') === 'product')
    const sum = (arr) => arr.reduce((a, p) => a + (Number(p.stock) || 0), 0)
    const sumMoney = (arr, k) =>
      arr.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p[k]) || 0), 0)
    const total = {
      qty: sum(goods),
      retail: sumMoney(goods, 'price'),
      cost: sumMoney(goods, 'cost'),
    }
    // «По магазину» — из seed по умолчанию у всех wh1, поэтому если есть
    // wh2 (магазин) — покажем и его, иначе просто повторим общий.
    const shop = warehouses[1] || warehouses[0] || null
    const inShop = shop ? goods.filter((p) => p.warehouseId === shop.id) : goods
    const perShop = shop
      ? {
          name: shop.name,
          qty: sum(inShop),
          retail: sumMoney(inShop, 'price'),
          cost: sumMoney(inShop, 'cost'),
        }
      : null
    return {
      total,
      perShop,
      warnCost0: goods.filter((p) => p.stock > 0 && !p.cost).length,
      warnNeg: goods.filter((p) => p.stock < 0).length,
    }
  }, [products, warehouses])

  const { total, perShop, warnCost0, warnNeg } = stockValuation

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <PackageMinus size={16} className="text-brand" /> Оценка склада
        </span>
      }
      subtitle={`Позиций в каталоге: ${num(products.length)}`}
    >
      <div className="space-y-3">
        {warnCost0 > 0 && (
          <div className="rounded-xl bg-warn-soft/50 border border-warn/30 px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={18} className="text-warn shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13px] text-warn">Внимание</div>
              <div className="text-[13px]">
                у {warnCost0} {plural(warnCost0, 'позиции', 'позиций', 'позиций')} себестоимость
                равна 0 ₽
              </div>
            </div>
            <Link
              to="/products?cost=0"
              className="text-[12px] px-3 h-8 rounded-lg bg-surface hover:bg-surface-2 border border-line grid place-items-center whitespace-nowrap"
            >
              Показать
            </Link>
          </div>
        )}
        {warnNeg > 0 && (
          <div className="rounded-xl bg-bad-soft/50 border border-bad/30 px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={18} className="text-bad shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13px] text-bad">Внимание</div>
              <div className="text-[13px]">
                у {warnNeg} {plural(warnNeg, 'позиции', 'позиций', 'позиций')} остаток меньше 0
              </div>
            </div>
            <Link
              to="/products?stockStatus=out"
              className="text-[12px] px-3 h-8 rounded-lg bg-surface hover:bg-surface-2 border border-line grid place-items-center whitespace-nowrap"
            >
              Показать
            </Link>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <ValuationCard title="Общая оценка" data={total} />
          {perShop && <ValuationCard title={`В магазине «${perShop.name}»`} data={perShop} />}
        </div>
      </div>
    </Section>
  )
}

function ValuationCard({ title, data }) {
  return (
    <Card className="p-4">
      <div className="font-semibold text-[14px] mb-3">{title}</div>
      <div className="space-y-3">
        <div>
          <div className="text-[11.5px] text-muted">Количество товара</div>
          <div className="text-xl font-bold tabular-nums">{num(data.qty)} ед.</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">В розничных ценах</div>
          <div className="text-xl font-bold tabular-nums">{money(data.retail)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">По себестоимости</div>
          <div className="text-xl font-bold tabular-nums text-muted">{money(data.cost)}</div>
        </div>
      </div>
    </Card>
  )
}
