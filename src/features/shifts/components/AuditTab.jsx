import { useState } from 'react'
import {
  Activity, ArrowDownToLine, Clock, ClipboardCheck, Download, LogIn, LogOut,
  Pencil, Plus, TrendingDown, Trash2, Undo2,
} from 'lucide-react'
import { Card, Button, Empty, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { relTime } from '@/shared/lib/format'
import { downloadCsv } from '@/shared/lib/export'

// Аудит-лента: все action-ы сотрудников. Разделы (Продажи/Склад/…) —
// теги, ими можно фильтровать. Иконки/цвета — по типу события. При
// экспорте: список фильтрованный, не весь.
const TONE_CLS = {
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  bad: 'bg-bad-soft text-bad',
  brand: 'bg-brand-soft text-brand',
  warn: 'bg-warn-soft text-warn',
  muted: 'bg-surface-2 text-muted',
}
const TYPE_ICON = {
  create: { icon: Plus, tone: 'ok' },
  update: { icon: Pencil, tone: 'info' },
  delete: { icon: Trash2, tone: 'bad' },
  login: { icon: LogIn, tone: 'brand' },
  logout: { icon: LogOut, tone: 'muted' },
  shift: { icon: Clock, tone: 'warn' },
  in: { icon: ArrowDownToLine, tone: 'ok' },
  writeoff: { icon: TrendingDown, tone: 'bad' },
  return: { icon: Undo2, tone: 'info' },
  inventory: { icon: ClipboardCheck, tone: 'warn' },
  info: { icon: Activity, tone: 'muted' },
}

export default function AuditTab() {
  const audit = useStore((s) => s.audit) || []
  const employees = useStore((s) => s.employees) || []
  const [section, setSection] = useState('all')
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  const sections = ['all', ...new Set(audit.map((a) => a.section))]
  const list = audit.filter((a) => section === 'all' || a.section === section)
  const exportCsv = () =>
    downloadCsv(`Журнал-действий-${new Date().toISOString().slice(0, 10)}`, list, [
      { key: 'at', label: 'Дата', map: (v) => new Date(v).toLocaleString('ru-RU') },
      { key: 'section', label: 'Раздел' },
      { key: 'title', label: 'Действие' },
      { key: 'by', label: 'Сотрудник', map: (v) => nameOf(v) },
    ])

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-1.5 p-3 border-b border-line overflow-x-auto no-scrollbar">
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cx(
              'px-3 h-8 rounded-lg text-[12px] font-medium whitespace-nowrap transition',
              section === s ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            {s === 'all' ? 'Все' : s}
          </button>
        ))}
        {list.length > 0 && (
          <Button variant="soft" size="sm" icon={Download} onClick={exportCsv} className="ml-auto shrink-0">
            <span className="hidden sm:inline">Экспорт</span>
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <Empty icon={Activity} title="Журнал пуст" text="Действия сотрудников появятся здесь." />
      ) : (
        <div className="divide-y divide-line max-h-[64vh] overflow-y-auto">
          {list.slice(0, 200).map((a) => {
            const ti = TYPE_ICON[a.type] || TYPE_ICON.info
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className={cx('h-8 w-8 rounded-lg grid place-items-center shrink-0', TONE_CLS[ti.tone])}>
                  <ti.icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{a.title}</div>
                  <div className="text-[12px] text-muted">{nameOf(a.by)} · {a.section}</div>
                </div>
                <div className="text-[12px] text-muted shrink-0">{relTime(a.at)}</div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
