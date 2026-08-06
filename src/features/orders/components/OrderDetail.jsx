import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  ChevronRight,
  Flag,
  Link2,
  Pencil,
  Printer,
  Route as RouteIcon,
  Undo2,
  X,
} from 'lucide-react'
import { Badge, Button, Card, StatusBadge, cx } from '@/shared/ui'
import DocPreviewModal from '@/shared/components/DocPreviewModal'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'
import { dateTime } from '@/shared/lib/format'
import { TRACK_FLOW, nextStatus, statusInfo } from '@/shared/lib/constants'
import { buildPickRoute } from '@/shared/lib/ai'
import { cellById } from '@/shared/store/seed'
import OrderItemsTable from './OrderItemsTable'
import OrderRoutePanel from './OrderRoutePanel'
import RefundModal from './RefundModal'

const isReceipt = (o) => o.kind === 'retail'

export default function OrderDetail({ order }) {
  const nav = useNavigate()
  const confirm = useConfirm()
  const advance = useStore((s) => s.advanceOrder)
  const cancel = useStore((s) => s.cancelOrder)
  const assignCourier = useStore((s) => s.assignCourier)
  const employees = useStore((s) => s.employees)
  const authUserId = useStore((s) => s.authUserId)
  const [showRoute, setShowRoute] = useState(false)
  const [copied, setCopied] = useState(false)
  const [printOrder, setPrintOrder] = useState(null)
  const [refundOpen, setRefundOpen] = useState(false)

  // Редактировать можно только пока заказ не отгружен и не отменён —
  // движок стора вернёт ok:false в других статусах, но UI не показываем.
  const canEdit = !order.stockConsumed && order.status !== 'cancelled'

  const me = employees.find((e) => e.id === authUserId)
  const canAssign = me?.role !== 'courier'
  const couriers = employees.filter((e) => e.role === 'courier' && e.active)

  const cur = statusInfo(order.status)
  const nx = nextStatus(order.status)
  const nxInfo = nx && statusInfo(nx)

  const route = useMemo(() => {
    const pts = order.items
      .map((it) => cellById(it.cell))
      .filter(Boolean)
      .map((c) => ({ ...c }))
    return buildPickRoute(pts)
  }, [order])

  const highlightCells = order.items.map((it) => it.cell)
  // F1-2: HashRouter требует /#/ — раньше клиенту улетала dead-ссылка
  // на root site. Учитываем и base path (GH Pages /skladpro/).
  const trackUrl = `${window.location.origin}${window.location.pathname}#/track/${order.id}`
  const copyLink = () => {
    navigator.clipboard?.writeText(trackUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleCancel = async () => {
    const ok = await confirm({
      title: `Отменить заказ ${order.no || '#' + order.id.slice(-4)}?`,
      body: 'Резерв возвращается на склад, клиенту уйдёт уведомление (если настроено). Действие можно повторить, только пересоздав заказ.',
      tone: 'warning',
      okLabel: 'Отменить заказ',
      cancelLabel: 'Не отменять',
    })
    if (ok) {
      // Legacy-чек не может быть отменён серверно — отказ показываем,
      // а не глотаем: молча «Отменён» без учёта хуже честного «нельзя».
      const r = cancel(order.id)
      if (r && r.ok === false) alert(r.error)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold tabular-nums">{order.no}</h3>
              {order.priority && (
                <Badge tone="bad">
                  <Flag size={11} /> Срочный
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted mt-0.5">
              {order.customerName} · {dateTime(order.createdAt)}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {/* Воронка статусов — только для заказов. Розничный чек закрыт в
            момент пробития: товар отдан, деньги получены, статусы
            «подтверждён → сборка → в пути» для него бессмысленны. */}
        {isReceipt(order) ? (
          <div className="mt-4 flex items-center gap-2.5 p-3 rounded-xl bg-ok-soft text-ok text-sm font-medium">
            <Check size={16} className="shrink-0" />
            Розничный чек · продажа закрыта
            {order.payment?.method && (
              <span className="ml-auto text-[12px] font-normal opacity-80">
                {order.payment.method === 'cash'
                  ? 'наличные'
                  : order.payment.method === 'card'
                    ? 'карта'
                    : order.payment.method === 'mixed'
                      ? 'смешанная'
                      : 'в долг'}
              </span>
            )}
          </div>
        ) : order.status !== 'cancelled' ? (
          <div className="mt-5 flex items-center">
            {TRACK_FLOW.map((s, i) => {
              const done = s.step < cur.step
              const here = s.step === cur.step
              return (
                <div key={s.key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={cx(
                        'h-8 w-8 rounded-full grid place-items-center text-[12px] font-semibold transition',
                        done && 'bg-ok text-white',
                        here && 'bg-brand text-white ring-4 ring-brand/20',
                        !done && !here && 'bg-surface-3 text-muted',
                      )}
                    >
                      {done ? <Check size={15} /> : i + 1}
                    </div>
                    <span
                      className={cx(
                        'text-[10px] mt-1 whitespace-nowrap',
                        here ? 'text-ink font-medium' : 'text-muted',
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < TRACK_FLOW.length - 1 && (
                    <div
                      className={cx(
                        'h-0.5 flex-1 mx-1 -mt-4 rounded',
                        s.step < cur.step ? 'bg-ok' : 'bg-surface-3',
                      )}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl bg-bad-soft text-bad text-sm font-medium">
            Заказ отменён
          </div>
        )}

        {/* Действия. Для чека остаются только «Печать» и «Отменить» —
            сборка/маршрут/ссылка клиенту к розничной продаже неприменимы. */}
        <div className="flex flex-wrap gap-2 mt-5">
          {!isReceipt(order) && nx && (
            <Button icon={ChevronRight} onClick={() => advance(order.id)}>
              {cur.step === 1 ? 'Начать сборку' : `В статус «${nxInfo.label}»`}
            </Button>
          )}
          {!isReceipt(order) && (
            <>
              <Button variant="soft" icon={RouteIcon} onClick={() => setShowRoute((v) => !v)}>
                {showRoute ? 'Скрыть маршрут' : 'Маршрут сборки'}
              </Button>
              <Button variant="soft" icon={copied ? Check : Link2} onClick={copyLink}>
                {copied ? 'Скопировано' : 'Ссылка клиенту'}
              </Button>
            </>
          )}
          <Button variant="soft" icon={Printer} onClick={() => setPrintOrder(order)}>
            {isReceipt(order) ? 'Печать чека' : 'Печать'}
          </Button>
          {!isReceipt(order) && canEdit && (
            <Button variant="soft" icon={Pencil} onClick={() => nav(`/orders/${order.id}/edit`)}>
              Изменить
            </Button>
          )}
          {/* C2: возврат по чеку. Для оригинальных чеков (не refund-order,
              не отменённых) — кнопка «Оформить возврат». */}
          {isReceipt(order) && order.kind !== 'refund' && order.status !== 'cancelled' && (
            <Button variant="soft" icon={Undo2} onClick={() => setRefundOpen(true)}>
              Оформить возврат
            </Button>
          )}
          {order.status !== 'cancelled' &&
            (!isReceipt(order) ? order.status !== 'delivered' : true) && (
              <Button variant="ghost" icon={X} className="text-bad" onClick={handleCancel}>
                {isReceipt(order) ? 'Аннулировать чек' : 'Отменить'}
              </Button>
            )}
        </div>
      </Card>

      {showRoute && (
        <OrderRoutePanel order={order} route={route} highlightCells={highlightCells} />
      )}

      <OrderItemsTable
        order={order}
        canAssign={canAssign}
        couriers={couriers}
        onAssignCourier={assignCourier}
      />

      {printOrder && (
        <DocPreviewModal
          doc={printOrder}
          category={printOrder.kind === 'refund' ? 'refund' : 'sale'}
          onClose={() => setPrintOrder(null)}
        />
      )}
      {refundOpen && <RefundModal order={order} onClose={() => setRefundOpen(false)} />}
    </div>
  )
}
