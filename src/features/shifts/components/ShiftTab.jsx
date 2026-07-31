import { useMemo, useState } from 'react'
import { Clock, PlayCircle, Receipt, ShoppingCart, StopCircle, Wallet } from 'lucide-react'
import { Card, Button, Badge, Field, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money, num, relTime } from '@/shared/lib/format'
import ShiftHistoryTable from './ShiftHistoryTable'

// Открытая смена + история закрытых. Открытие связывается с кассой (accountId
// нужен, чтобы addOrder→moneyTx попадал в правильный счёт — T1-A). Закрытие
// принимает фактические наличные, из них считается расхождение.
export default function ShiftTab() {
  const { shifts, activeShiftId, orders, employees, warehouses, accounts, openShift, closeShift } =
    useStore()
  const [openCash, setOpenCash] = useState('5000')
  const [closeCash, setCloseCash] = useState('')
  const cashAccounts = (accounts || []).filter((a) => a.kind === 'cash')
  const [openAccountId, setOpenAccountId] = useState(cashAccounts[0]?.id || '')
  const [openErr, setOpenErr] = useState('')

  const doOpen = () => {
    setOpenErr('')
    const r = openShift(openCash, openAccountId || null)
    if (r && r.ok === false) setOpenErr(r.error || 'Не удалось открыть смену')
  }

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
            <Button variant="danger" icon={StopCircle} onClick={doClose}>Закрыть смену</Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <h3 className="font-semibold mb-1">Смена закрыта</h3>
          <p className="text-sm text-muted mb-4">
            Откройте смену, чтобы продажи и операции учитывались по кассе.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Касса" className="w-56">
              <select
                value={openAccountId}
                onChange={(e) => setOpenAccountId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand"
                disabled={!cashAccounts.length}
              >
                {cashAccounts.length === 0 && (
                  <option value="">Нет касс — добавьте в разделе «Кассы»</option>
                )}
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Наличные в кассе на начало" className="w-56">
              <input
                type="number"
                value={openCash}
                onChange={(e) => setOpenCash(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand"
              />
            </Field>
            <Button icon={PlayCircle} onClick={doOpen} disabled={!cashAccounts.length}>
              Открыть смену
            </Button>
          </div>
          {openErr && <div className="mt-3 text-[13px] text-bad">{openErr}</div>}
        </Card>
      )}

      <ShiftHistoryTable
        history={history}
        nameOf={nameOf}
        orders={orders}
        employees={employees}
        warehouses={warehouses || []}
        accounts={accounts || []}
      />
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
