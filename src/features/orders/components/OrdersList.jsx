import { Flag, Search } from 'lucide-react'
import { Badge, Empty, Input, StatusBadge, cx } from '@/shared/ui'
import { dateShort, money } from '@/shared/lib/format'
import { isReceipt } from '@/shared/lib/orders'

export const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'orders', label: 'Заказы' },
  { key: 'receipts', label: 'Чеки' },
  { key: 'new', label: 'Новые' },
  { key: 'picking', label: 'Сборка' },
  { key: 'shipped', label: 'В пути' },
  { key: 'delivered', label: 'Доставлены' },
]

export default function OrdersList({
  list,
  q,
  setQ,
  filter,
  setFilter,
  selectedId,
  onSelect,
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
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
              filter === f.key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
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
            onClick={() => onSelect(o.id)}
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
              {isReceipt(o) ? (
                <Badge tone="ok" className="text-[11px]">Чек</Badge>
              ) : (
                <StatusBadge status={o.status} />
              )}
            </div>
            <div className="text-sm mt-1.5 truncate">{o.customerName}</div>
            <div className="flex items-center justify-between mt-1 text-[12px] text-muted">
              <span>{dateShort(o.createdAt)}</span>
              <span className="font-medium text-ink">{money(o.total)}</span>
            </div>
          </button>
        ))}
        {list.length === 0 && <Empty icon={Search} title="Заказы не найдены" />}
      </div>
    </div>
  )
}
