import { AlertTriangle, BarChart3 } from 'lucide-react'
import { Badge, Card, Empty, cx } from '@/shared/ui'
import { money, num } from '@/shared/lib/format'
import { statusDot } from '../timeline'

export default function MovementsTable({ groups, totalCount, nameOf, fmtTime }) {
  if (groups.length === 0) {
    return (
      <Card className="overflow-hidden">
        <Empty
          icon={BarChart3}
          title="Ничего не найдено"
          text="Смените период или сбросьте фильтры."
        />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2/60 text-muted text-[11.5px] uppercase tracking-wide">
            <tr>
              <th className="w-8 pl-3 py-2"></th>
              <th className="text-left py-2 pr-3">Документ</th>
              <th className="text-left py-2 pr-3 w-16">Время</th>
              <th className="text-right py-2 pr-3 w-16">Поз.</th>
              <th className="text-right py-2 pr-3 w-28">Сумма</th>
              <th className="text-right py-2 pr-3 w-28">Оплачено</th>
              <th className="text-left py-2 pr-3">Отправитель</th>
              <th className="text-left py-2 pr-3">Получатель</th>
              <th className="text-left py-2 pr-3 w-32">Автор</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <DayGroup
                key={g.label}
                label={g.label}
                rows={g.rows}
                nameOf={nameOf}
                fmtTime={fmtTime}
              />
            ))}
          </tbody>
        </table>
      </div>
      {totalCount > 500 && (
        <div className="px-4 py-2 text-[12px] text-muted border-t border-line">
          Показаны первые 500 из {totalCount}. Сузьте фильтр, чтобы увидеть остальное.
        </div>
      )}
    </Card>
  )
}

// Одна группа-день: строка-заголовок (sticky) + строки-документы.
function DayGroup({ label, rows, nameOf, fmtTime }) {
  return (
    <>
      <tr className="sticky top-0 z-10 bg-surface-3 text-ink">
        <td colSpan={9} className="px-3 py-1.5 text-[12px] font-semibold">
          {label} · {rows.length}
        </td>
      </tr>
      {rows.map((r, i) => {
        const dot = statusDot(r)
        const cancelled = r.status === 'cancelled'
        const draft = r.status === 'draft'
        return (
          <tr
            key={`${r.kind}-${r.no}-${i}`}
            className={cx(
              'border-t border-line hover:bg-surface-2/60 transition cursor-pointer',
              cancelled && 'opacity-50 line-through',
            )}
            onClick={() => (window.location.hash = r.href.replace(/^#/, ''))}
          >
            <td className="pl-3 py-2 align-middle">
              <span
                className={cx('inline-block w-2.5 h-2.5 rounded-full', dot.color)}
                title={dot.title}
              />
            </td>
            <td className="py-2 pr-3 align-middle">
              <div className="flex items-center gap-1.5">
                {draft && (
                  <AlertTriangle size={13} className="text-warn shrink-0" title="Черновик" />
                )}
                <span className="font-medium truncate">{r.title}</span>
                <Badge tone="brand" className="text-[10px] shrink-0">{r.no}</Badge>
              </div>
            </td>
            <td className="py-2 pr-3 align-middle tabular-nums text-muted">{fmtTime(r.at)}</td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums">
              {r.qty != null ? num(r.qty) : ''}
            </td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums font-medium">
              {r.sum != null ? money(r.sum) : ''}
            </td>
            <td className="py-2 pr-3 align-middle text-right tabular-nums">
              {r.paid != null && r.paid > 0 ? (
                <span className={cx(r.sum && r.paid >= r.sum ? 'text-ok' : 'text-warn')}>
                  {money(r.paid)}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td className="py-2 pr-3 align-middle truncate max-w-[180px]">{r.from || '—'}</td>
            <td className="py-2 pr-3 align-middle truncate max-w-[180px]">{r.to || '—'}</td>
            <td className="py-2 pr-3 align-middle truncate max-w-[140px] text-muted">
              {r.by ? nameOf(r.by) : ''}
            </td>
          </tr>
        )
      })}
    </>
  )
}
