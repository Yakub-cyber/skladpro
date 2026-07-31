import { useState } from 'react'
import { Activity, Clock } from 'lucide-react'
import { cx } from '@/shared/ui'
import ShiftTab from './components/ShiftTab'
import AuditTab from './components/AuditTab'

// Тонкий router по табам: «Смена» (открыть/закрыть + история) и «Действия»
// (аудит-лента). Всё содержимое — в components/.
const TABS = [
  { key: 'shift', label: 'Смена', icon: Clock },
  { key: 'audit', label: 'Действия', icon: Activity },
]

export default function Journal() {
  const [tab, setTab] = useState('shift')
  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Смены и журнал</h2>
        <p className="text-sm text-muted">Кассовые смены и лог всех действий сотрудников.</p>
      </div>
      <div className="flex gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'flex items-center gap-2 px-3.5 h-10 rounded-xl text-[13px] font-medium transition',
              tab === t.key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'shift' ? <ShiftTab /> : <AuditTab />}
    </div>
  )
}
