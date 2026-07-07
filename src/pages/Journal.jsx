import { useMemo, useState } from 'react'
import {
  Clock,
  Wallet,
  PlayCircle,
  StopCircle,
  History,
  Printer,
  Plus,
  Pencil,
  Trash2,
  LogIn,
  LogOut,
  ArrowDownToLine,
  TrendingDown,
  Undo2,
  ClipboardCheck,
  ShoppingCart,
  Activity,
  Receipt,
  Download,
} from 'lucide-react'
import { Card, Section, Button, Badge, Field, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateTime, relTime } from '../lib/format'
import { roleInfo } from '../lib/constants'
import { downloadCsv } from '../lib/export'

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

// ── Смены ───────────────────────────────────────────────────────────────────
function ShiftTab() {
  const { shifts, activeShiftId, orders, employees, authUserId, openShift, closeShift } =
    useStore()
  const [openCash, setOpenCash] = useState('5000')
  const [closeCash, setCloseCash] = useState('')

  const active = shifts.find((s) => s.id === activeShiftId)
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'

  const liveStats = useMemo(() => {
    if (!active) return null
    const os = orders.filter((o) => o.shiftId === active.id && o.status !== 'cancelled')
    return { revenue: os.reduce((a, o) => a + o.total, 0), count: os.length }
  }, [active, orders])

  const history = shifts.filter((s) => s.closedAt)

  const doClose = () => {
    closeShift(closeCash)
    setCloseCash('')
  }

  return (
    <div className="space-y-5">
      {active ? (
        <Card className="p-5 border-ok/30">
          <div className="flex items-center gap-2 mb-4">
            <span className="relative flex h-2.5 w-2.5">
              <span className="ping-soft absolute text-ok" />
              <span className="relative rounded-full h-2.5 w-2.5 bg-ok" />
            </span>
            <h3 className="font-semibold">Смена открыта</h3>
            <Badge tone="ok" className="ml-auto">{nameOf(active.userId)}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Mini icon={Clock} label="Открыта" value={relTime(active.openedAt)} />
            <Mini icon={Wallet} label="Касса на старт" value={money(active.openingCash)} />
            <Mini icon={ShoppingCart} label="Заказов" value={num(liveStats.count)} />
            <Mini icon={Receipt} label="Выручка" value={money(liveStats.revenue)} tone="ok" />
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-4 border-t border-line">
            <Field label="Наличные в кассе (факт)" className="w-44">
              <input
                type="number"
                value={closeCash}
                onChange={(e) => setCloseCash(e.target.value)}
                placeholder={String(active.openingCash + liveStats.revenue)}
                className="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand"
              />
            </Field>
            <Button variant="danger" icon={StopCircle} onClick={doClose}>
              Закрыть смену
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">Смена закрыта</h3>
          <p className="text-sm text-muted mb-4">
            Откройте смену, чтобы продажи и операции учитывались по кассе.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Наличные в кассе на начало" className="w-56">
              <input
                type="number"
                value={openCash}
                onChange={(e) => setOpenCash(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand"
              />
            </Field>
            <Button icon={PlayCircle} onClick={() => openShift(openCash)}>
              Открыть смену
            </Button>
          </div>
        </Card>
      )}

      <Section title="История смен">
        {history.length === 0 ? (
          <Empty icon={History} title="Закрытых смен пока нет" />
        ) : (
          <div className="space-y-2">
            {history.map((s) => {
              const diff = (s.closingCash || 0) - (s.openingCash + (s.revenue || 0))
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">{nameOf(s.userId)}</div>
                    <div className="text-[12px] text-muted">
                      {dateTime(s.openedAt)} — {dateTime(s.closedAt).slice(-5)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] text-muted">Выручка</div>
                    <div className="text-sm font-medium tabular-nums">{money(s.revenue || 0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] text-muted">Заказов</div>
                    <div className="text-sm font-medium tabular-nums">{num(s.ordersCount || 0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] text-muted">Касса</div>
                    <Badge tone={diff === 0 ? 'ok' : 'warn'}>
                      {diff === 0 ? 'сходится' : `${diff > 0 ? '+' : ''}${num(diff)} ₽`}
                    </Badge>
                  </div>
                  <Button size="sm" variant="ghost" icon={Printer} onClick={() => printZReport(s, nameOf(s.userId))}>
                    Z-отчёт
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function Mini({ icon: Icon, label, value, tone = 'brand' }) {
  return (
    <div className="p-3 rounded-xl bg-surface-2">
      <div className="text-[11px] text-muted flex items-center gap-1">
        <Icon size={12} /> {label}
      </div>
      <div className={cx('font-semibold text-sm mt-0.5', tone === 'ok' && 'text-ok')}>{value}</div>
    </div>
  )
}

// ── Аудит ───────────────────────────────────────────────────────────────────
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

function AuditTab() {
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
          <Button
            variant="soft"
            size="sm"
            icon={Download}
            onClick={exportCsv}
            className="ml-auto shrink-0"
          >
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
                  <div className="text-[12px] text-muted">
                    {nameOf(a.by)} · {a.section}
                  </div>
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

function printZReport(s, name) {
  const diff = (s.closingCash || 0) - (s.openingCash + (s.revenue || 0))
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Z-отчёт</title>
  <style>*{font-family:Arial,sans-serif}body{margin:0;padding:24px;max-width:360px}
  h1{font-size:17px;margin:0 0 2px}.muted{color:#666;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:14px}td{padding:6px 0;font-size:14px}
  td:last-child{text-align:right;font-weight:600}tr{border-bottom:1px dashed #ccc}
  .tot td{font-size:16px;font-weight:800;border-bottom:none;padding-top:10px}
  @media print{body{padding:6px}}</style></head><body>
  <h1>Z-отчёт по смене</h1>
  <div class="muted">${name} · ${new Date(s.openedAt).toLocaleString('ru-RU')}</div>
  <table>
    <tr><td>Касса на начало</td><td>${num(s.openingCash)} ₽</td></tr>
    <tr><td>Заказов за смену</td><td>${num(s.ordersCount || 0)}</td></tr>
    <tr><td>Складских операций</td><td>${num(s.movesCount || 0)}</td></tr>
    <tr><td>Выручка</td><td>${num(s.revenue || 0)} ₽</td></tr>
    <tr><td>Касса на конец</td><td>${num(s.closingCash || 0)} ₽</td></tr>
    <tr class="tot"><td>Расхождение</td><td>${diff === 0 ? '0 ₽ ✓' : `${diff > 0 ? '+' : ''}${num(diff)} ₽`}</td></tr>
  </table>
  <script>window.onload=()=>window.print()</script></body></html>`
  const w = window.open('', '_blank', 'width=420,height=700')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}
