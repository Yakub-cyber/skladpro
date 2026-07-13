// Журнал складских движений — плоский лог с иконкой типа и дельтой
// остатка. Показываем последние 100, полный экспорт в CSV.
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ClipboardCheck,
  Download,
  History,
  TrendingDown,
  Truck,
  Undo2,
} from 'lucide-react'
import { Card, Button, Empty, cx } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { num, relTime } from '../../lib/format'
import { downloadCsv } from '../../lib/export'

const MV = {
  in: { label: 'Закупка', icon: ArrowDownToLine, tone: 'ok' },
  writeoff: { label: 'Списание', icon: TrendingDown, tone: 'bad' },
  return: { label: 'Возврат продажи', icon: Undo2, tone: 'info' },
  supplier_return: { label: 'Возврат поставщику', icon: Truck, tone: 'bad' },
  transfer: { label: 'Перемещение', icon: ArrowLeftRight, tone: 'info' },
  inventory: { label: 'Инвентаризация', icon: ClipboardCheck, tone: 'warn' },
}

export default function JournalTab() {
  const movements = useStore((s) => s.movements) || []
  const employees = useStore((s) => s.employees) || []
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  if (!movements.length) {
    return <Empty icon={History} title="Журнал пуст" text="Закупки, возвраты, перемещения, списания и инвентаризации появятся здесь." />
  }

  const exportCsv = () =>
    downloadCsv(`Движения-${new Date().toISOString().slice(0, 10)}`, movements, [
      { key: 'at', label: 'Дата', map: (v) => new Date(v).toLocaleString('ru-RU') },
      { key: 'type', label: 'Операция', map: (v) => (MV[v] || MV.in).label },
      { key: 'name', label: 'Товар' },
      { key: 'qty', label: 'Кол-во' },
      { key: 'delta', label: 'Изменение остатка' },
      { key: 'reason', label: 'Причина' },
      { key: 'by', label: 'Сотрудник', map: (v) => nameOf(v) },
    ])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-muted">
          Показаны последние {Math.min(movements.length, 100)} из {movements.length}
        </span>
        <Button variant="soft" size="sm" icon={Download} onClick={exportCsv}>
          Экспорт CSV
        </Button>
      </div>
      <Card className="overflow-hidden">
        <div className="divide-y divide-line">
          {movements.slice(0, 100).map((m) => {
            const info = MV[m.type] || MV.in
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className={cx('h-9 w-9 rounded-lg grid place-items-center shrink-0', `bg-${info.tone}-soft text-${info.tone}`)}>
                  <info.icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.name}</div>
                  <div className="text-[12px] text-muted">
                    {info.label} · {m.reason} · {nameOf(m.by)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cx('text-sm font-semibold tabular-nums', m.delta === 0 ? 'text-muted' : m.delta > 0 ? 'text-ok' : 'text-bad')}>
                    {m.delta === 0 ? '↔' : `${m.delta > 0 ? '+' : ''}${num(m.delta)}`}
                  </div>
                  <div className="text-[11px] text-muted">{relTime(m.at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}
