import { useMemo } from 'react'
import {
  Sparkles,
  PackageMinus,
  TrendingDown,
  Flame,
  Snowflake,
  TrendingUp,
  Percent,
  Boxes,
} from 'lucide-react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card, Section, Stat, Badge, Empty } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { analyticsInsights, soldByProduct } from '../lib/ai'
import { CATEGORIES, catInfo } from '../lib/constants'

const INSIGHT_ICON = { PackageMinus, TrendingDown, Flame, Snowflake }
const SEV = {
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
}

export default function Analytics() {
  const { products, orders } = useStore()

  const d = useMemo(() => {
    const sold = soldByProduct(orders)

    // выручка по категориям
    const byCat = {}
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      for (const it of o.items) {
        const p = products.find((x) => x.id === it.productId)
        const cat = p?.category || 'Прочее'
        byCat[cat] = (byCat[cat] || 0) + it.qty * it.price
      }
    }
    const pie = CATEGORIES.map((c) => ({
      name: c.key,
      value: Math.round(byCat[c.key] || 0),
      color: c.color,
    })).filter((x) => x.value > 0)

    // топ товары (выручка)
    const top = products
      .map((p) => ({ p, rev: (sold[p.id] || 0) * p.price, q: sold[p.id] || 0 }))
      .filter((x) => x.rev > 0)
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 7)
      .map((x) => ({ name: x.p.name.slice(0, 16), rev: Math.round(x.rev) }))

    // прогноз исчерпания
    const forecast = products
      .map((p) => {
        const perDay = (sold[p.id] || 0) / 30
        const days = perDay > 0 ? Math.round(p.stock / perDay) : null
        const reco = perDay > 0 ? Math.max(0, Math.ceil(perDay * 30 - p.stock)) : 0
        return { p, perDay, days, reco }
      })
      .filter((x) => x.perDay > 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 10)

    const revenue = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((a, o) => a + o.total, 0)
    const margin =
      products.reduce((a, p) => a + (p.price - p.cost) / p.price, 0) / products.length
    const stockValue = products.reduce((a, p) => a + p.stock * p.cost, 0)

    return { pie, top, forecast, revenue, margin, stockValue }
  }, [products, orders])

  const insights = useMemo(
    () => analyticsInsights({ products, orders }),
    [products, orders],
  )

  return (
    <div className="animate-fadeUp space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          Аналитика <Badge tone="brand"><Sparkles size={12} /> ИИ</Badge>
        </h2>
        <p className="text-sm text-muted">Прогнозы, выручка и рекомендации по закупкам.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Выручка" value={money(d.revenue)} icon={TrendingUp} tone="brand" />
        <Stat label="Средняя маржа" value={`${Math.round(d.margin * 100)}%`} icon={Percent} tone="ok" />
        <Stat label="Склад в закупке" value={money(d.stockValue)} icon={Boxes} tone="info" />
        <Stat
          label="В зоне риска"
          value={num(d.forecast.filter((f) => f.days <= 10).length)}
          sub="скоро закончатся"
          icon={TrendingDown}
          tone="warn"
        />
      </div>

      {/* ИИ-инсайты */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" /> Рекомендации ИИ
          </span>
        }
      >
        <div className="grid md:grid-cols-2 gap-3">
          {insights.map((ins) => {
            const Icon = INSIGHT_ICON[ins.icon] || Sparkles
            return (
              <div key={ins.id} className="flex gap-3 p-3 rounded-xl bg-surface-2">
                <div className={`h-9 w-9 rounded-lg grid place-items-center shrink-0 ${SEV[ins.severity]}`}>
                  <Icon size={17} />
                </div>
                <div>
                  <p className="text-sm font-medium">{ins.title}</p>
                  <p className="text-[12px] text-muted mt-0.5 leading-relaxed">{ins.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Выручка по категориям">
          {d.pie.length ? (
            <div className="flex items-center gap-4">
              <div className="h-[220px] w-[220px] shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={d.pie}
                      dataKey="value"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {d.pie.map((e) => (
                        <Cell key={e.name} fill={e.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                {d.pie
                  .sort((a, b) => b.value - a.value)
                  .map((e) => (
                    <div key={e.name} className="flex items-center gap-2 text-sm">
                      <span className="w-3 h-3 rounded" style={{ background: e.color }} />
                      <span className="flex-1 truncate">{e.name}</span>
                      <span className="tabular-nums font-medium">{money(e.value)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <Empty icon={Boxes} title="Недостаточно данных" />
          )}
        </Section>

        <Section title="Топ товаров по выручке">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.top} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${Math.round(v / 1000)}к`}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip content={<BarTip />} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="rev" fill="var(--brand)" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Прогноз исчерпания */}
      <Section title="Прогноз исчерпания запасов" subtitle="Сортировка по скорости расхода">
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line">
                <th className="font-medium py-2 px-2">Товар</th>
                <th className="font-medium py-2 px-2 text-right">Остаток</th>
                <th className="font-medium py-2 px-2 text-right">Расход/день</th>
                <th className="font-medium py-2 px-2 text-right">Хватит на</th>
                <th className="font-medium py-2 px-2 text-right">Заказать</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.forecast.map(({ p, perDay, days, reco }) => {
                const c = catInfo(p.category)
                return (
                  <tr key={p.id}>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                        {p.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {num(p.stock)} {p.unit}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-muted">
                      {perDay.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <Badge tone={days <= 7 ? 'bad' : days <= 14 ? 'warn' : 'ok'}>
                        {days} дн
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums font-medium">
                      {reco > 0 ? `+${num(reco)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {d.forecast.length === 0 && <Empty icon={TrendingDown} title="Нет данных о продажах" />}
        </div>
      </Section>
    </div>
  )
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div className="card px-3 py-2 text-sm shadow-lg">
      <div className="font-medium">{payload[0].name}</div>
      <div className="text-muted">{money(payload[0].value)}</div>
    </div>
  )
}
function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="card px-3 py-2 text-sm shadow-lg">
      <div className="text-muted text-[12px]">{label}</div>
      <div className="font-semibold">{money(payload[0].value)}</div>
    </div>
  )
}
