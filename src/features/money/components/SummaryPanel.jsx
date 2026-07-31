import { Card, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'
import { purposeLabel } from '@/shared/lib/money'

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
  { key: 'month', label: '30 дней' },
  { key: 'all', label: 'Всё время' },
]

// Панель сводки за период — компактная «касса-книга»: приход, расход,
// чистое движение + разбивка по назначениям.
export default function SummaryPanel({ summary, period, setPeriod, filteredByAccount }) {
  const inItems = Object.entries(summary.inByPurpose).sort((a, b) => b[1] - a[1])
  const outItems = Object.entries(summary.outByPurpose).sort((a, b) => b[1] - a[1])

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] font-medium">Сводка за период</span>
        <div className="flex gap-1 bg-surface-2 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cx(
                'px-2.5 h-7 rounded-md text-[12px] font-medium transition',
                period === p.key ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-muted ml-auto">
          {summary.count} движений
          {filteredByAccount && ' · по выбранному счёту (переводы учтены)'}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-2.5">
        <SummaryTile
          label="Приход"
          value={summary.inTotal}
          tone="ok"
          items={inItems.map(([k, v]) => ({
            label: purposeLabel('in', k) || purposeLabel('transfer', k),
            value: v,
          }))}
        />
        <SummaryTile
          label="Расход"
          value={summary.outTotal}
          tone="bad"
          items={outItems.map(([k, v]) => ({
            label: purposeLabel('out', k) || purposeLabel('transfer', k),
            value: v,
          }))}
        />
        <SummaryTile
          label="Чистое движение"
          value={summary.net}
          tone={summary.net > 0 ? 'ok' : summary.net < 0 ? 'bad' : 'brand'}
          hero
        />
      </div>
    </Card>
  )
}

function SummaryTile({ label, value, tone, items = [], hero = false }) {
  const cls =
    tone === 'ok'
      ? 'text-ok bg-ok-soft/40'
      : tone === 'bad'
        ? 'text-bad bg-bad-soft/40'
        : 'text-brand bg-brand-soft/40'
  return (
    <div className={cx('rounded-xl p-3', cls)}>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cx('font-bold tabular-nums', hero ? 'text-2xl' : 'text-xl')}>
        {value > 0 && tone !== 'bad' ? '+' : ''}
        {value < 0 ? '−' : ''}
        {money(Math.abs(value))}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted">
          {items.slice(0, 4).map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{it.label || 'прочее'}</span>
              <span className="tabular-nums shrink-0 text-ink">{money(it.value)}</span>
            </li>
          ))}
          {items.length > 4 && (
            <li className="text-muted italic">ещё {items.length - 4}…</li>
          )}
        </ul>
      )}
    </div>
  )
}
