import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Plus,
  Route as RouteIcon,
  Check,
  ChevronRight,
  Link2,
  MapPin,
  Truck,
  X,
  Trash2,
  Search,
  Flag,
  Copy,
  Printer,
  Pencil,
  Minus,
  Undo2,
} from 'lucide-react'
import {
  Card,
  Button,
  StatusBadge,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Empty,
  cx,
} from '../components/ui'
import WarehouseMap from '../components/WarehouseMap'
import { useConfirm } from '../components/Confirm'
import { useStore } from '../store/useStore'
import { money, dateTime, dateShort, plural, num } from '../lib/format'
import {
  TRACK_FLOW,
  statusInfo,
  nextStatus,
  ORDER_STATUSES,
  priceFor,
} from '../lib/constants'
import { buildPickRoute } from '../lib/ai'
import DocPreviewModal from '../components/DocPreviewModal'
import { cellById } from '../store/seed'

// «Чеки» и «Заказы» — две разные сущности в одном списке:
//   kind='retail' — розничный чек из кассы, закрыт сразу, без воронки
//   kind='order'  — заказ с доставкой, идёт по статусам
// Старые записи без `kind` считаем заказами (обратная совместимость).
const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'orders', label: 'Заказы' },
  { key: 'receipts', label: 'Чеки' },
  { key: 'new', label: 'Новые' },
  { key: 'picking', label: 'Сборка' },
  { key: 'shipped', label: 'В пути' },
  { key: 'delivered', label: 'Доставлены' },
]

const isReceipt = (o) => o.kind === 'retail'

export default function Orders() {
  const allOrders = useStore((s) => s.orders)
  const employees = useStore((s) => s.employees)
  const authUserId = useStore((s) => s.authUserId)
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  // Начальный фильтр можно задать через URL: /orders?filter=new — так
  // NAV-пункт «Заявки клиентов» ведёт на предфильтрованный список.
  const initialFilter = params.get('filter') || 'all'
  const [filter, setFilter] = useState(initialFilter)
  useEffect(() => {
    const f = params.get('filter')
    if (f && f !== filter) setFilter(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  const [q, setQ] = useState('')

  // курьер видит только назначенные ему заказы
  const me = employees.find((e) => e.id === authUserId)
  const isCourier = me?.role === 'courier'
  const orders = useMemo(
    () => (isCourier ? allOrders.filter((o) => o.assignedTo === authUserId) : allOrders),
    [allOrders, isCourier, authUserId],
  )

  // На десктопе — split-view с выбранным по умолчанию первым заказом.
  // На мобиле — стартуем БЕЗ выбранного, чтобы не открывалась модалка
  // деталей автоматически при заходе на страницу.
  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 1023px)').matches
  const urlId = params.get('id')
  const selectedId = urlId || (isMobile ? null : orders[0]?.id)
  const selected = orders.find((o) => o.id === selectedId)
  // Модалка деталей открывается на мобиле только при явном выборе (URL id).
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    if (urlId && isMobile) setDetailOpen(true)
  }, [urlId, isMobile])
  const closeDetail = () => {
    setDetailOpen(false)
    setParams({}) // убираем ?id=... из URL, чтобы клик на тот же заказ снова открыл модалку
  }

  const list = useMemo(() => {
    return orders.filter((o) => {
      const okF =
        filter === 'all'
          ? true
          : filter === 'orders'
            ? !isReceipt(o)
            : filter === 'receipts'
              ? isReceipt(o)
              : filter === 'active'
                // «Активные» — с Dashboard «Активные заказы» кликом:
                // всё, что ещё в работе. Чеки сюда не попадают — они
                // закрыты в момент пробития.
                ? !isReceipt(o) && !['delivered', 'cancelled'].includes(o.status)
                : filter === 'new'
                  ? !isReceipt(o) && ['new', 'confirmed'].includes(o.status)
                  : filter === 'shipped'
                    ? ['packed', 'shipped'].includes(o.status)
                    : o.status === filter
      const okQ =
        !q ||
        o.no.toLowerCase().includes(q.toLowerCase()) ||
        o.customerName.toLowerCase().includes(q.toLowerCase())
      return okF && okQ
    })
  }, [orders, filter, q])

  const select = (id) => {
    setParams({ id })
    if (isMobile) setDetailOpen(true)
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Заказы</h2>
          <p className="text-sm text-muted">
            {orders.length} всего ·{' '}
            {orders.filter((o) => !isReceipt(o) && ['new', 'confirmed', 'picking'].includes(o.status)).length} в обработке
            {' · '}
            {orders.filter(isReceipt).length} чеков
          </p>
        </div>
        <Button icon={Plus} onClick={() => nav('/orders/new')}>
          Новый заказ
        </Button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-5">
        {/* Список */}
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
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
                  filter === f.key
                    ? 'bg-brand text-brand-ink'
                    : 'bg-surface-2 text-muted hover:text-ink',
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
                onClick={() => select(o.id)}
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
            {list.length === 0 && (
              <Empty icon={Search} title="Заказы не найдены" />
            )}
          </div>
        </div>

        {/* Детали — только на десктопе inline. На мобиле → в модалке ниже. */}
        <div className="hidden lg:block">
          {selected ? (
            <OrderDetail key={selected.id} order={selected} />
          ) : (
            <Card className="grid place-items-center">
              <Empty icon={RouteIcon} title="Выберите заказ" text="Слева — список заказов." />
            </Card>
          )}
        </div>
      </div>

      {/* Mobile: модалка деталей вместо длинной прокрутки вниз списка */}
      <Modal
        open={detailOpen && !!selected}
        onClose={closeDetail}
        wide
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{selected.no}</span>
              <StatusBadge status={selected.status} />
            </span>
          ) : (
            'Заказ'
          )
        }
      >
        {selected && <OrderDetail key={selected.id} order={selected} />}
      </Modal>
    </div>
  )
}

function OrderDetail({ order }) {
  const nav = useNavigate()
  const confirm = useConfirm()
  const advance = useStore((s) => s.advanceOrder)
  const cancel = useStore((s) => s.cancelOrder)
  const handleCancel = async () => {
    const ok = await confirm({
      title: `Отменить заказ ${order.no || '#' + order.id.slice(-4)}?`,
      body: 'Резерв возвращается на склад, клиенту уйдёт уведомление (если настроено). Действие можно повторить, только пересоздав заказ.',
      tone: 'warning',
      okLabel: 'Отменить заказ',
      cancelLabel: 'Не отменять',
    })
    if (ok) cancel(order.id)
  }
  const assignCourier = useStore((s) => s.assignCourier)
  const employees = useStore((s) => s.employees)
  const authUserId = useStore((s) => s.authUserId)
  const settings = useStore((s) => s.settings)
  const customers = useStore((s) => s.customers)
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

        {/* Воронка статусов — только для заказов. Розничный чек закрыт
            в момент пробития: товар отдан, деньги получены, статусы
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
              <Button
                variant="soft"
                icon={RouteIcon}
                onClick={() => setShowRoute((v) => !v)}
              >
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
              не отменённых) — кнопка «Оформить возврат». В обычных
              заказах пока не показываем — там свой sale_return-документ. */}
          {isReceipt(order) && order.kind !== 'refund' && order.status !== 'cancelled' && (
            <Button
              variant="soft"
              icon={Undo2}
              onClick={() => setRefundOpen(true)}
            >
              Оформить возврат
            </Button>
          )}
          {order.status !== 'cancelled' && (!isReceipt(order) ? order.status !== 'delivered' : true) && (
            <Button
              variant="ghost"
              icon={X}
              className="text-bad"
              onClick={handleCancel}
            >
              {isReceipt(order) ? 'Аннулировать чек' : 'Отменить'}
            </Button>
          )}
        </div>
      </Card>

      {/* Правка заказа переехала на отдельную страницу /orders/:id/edit —
          для оптовика с 100+ позициями там плотная таблица с Tab-навигацией,
          Ctrl+S и «/» на поиск. */}

      {/* Маршрут сборки */}
      {showRoute && (
        <Card className="p-5 animate-fadeUp">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold flex items-center gap-2">
              <RouteIcon size={17} className="text-brand" /> Маршрут сборщика
            </h4>
            <Badge tone="brand">
              ~{route.distance} м пути · {route.order.length}{' '}
              {plural(route.order.length, 'точка', 'точки', 'точек')}
            </Badge>
          </div>
          <div className="grid md:grid-cols-[1fr_240px] gap-4">
            <div className="rounded-xl border border-line bg-surface-2 p-2">
              <WarehouseMap
                cells={useStore.getState().cells}
                products={useStore.getState().products}
                highlight={highlightCells}
                route={route}
              />
            </div>
            <ol className="space-y-2">
              {route.order.map((c, i) => {
                const it = order.items.find((x) => x.cell === c.id)
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-2"
                  >
                    <span className="h-6 w-6 shrink-0 rounded-full bg-brand text-white text-[12px] font-semibold grid place-items-center">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">
                        {it?.name}
                      </div>
                      <div className="text-[11px] text-muted">
                        Ячейка {c.id} · {num(it?.qty)} {it?.unit}
                      </div>
                    </div>
                  </li>
                )
              })}
              <li className="flex items-center gap-2.5 p-2 rounded-lg bg-ok-soft text-ok">
                <span className="h-6 w-6 shrink-0 rounded-full bg-ok text-white grid place-items-center">
                  <Check size={13} />
                </span>
                <span className="text-[13px] font-medium">Возврат на выдачу</span>
              </li>
            </ol>
          </div>
        </Card>
      )}

      {/* Позиции */}
      <Card className="p-5">
        <h4 className="font-semibold mb-3">
          Состав заказа · {order.items.length}{' '}
          {plural(order.items.length, 'позиция', 'позиции', 'позиций')}
        </h4>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line">
                <th className="font-medium pb-2 px-1">Товар</th>
                <th className="font-medium pb-2 px-1">Ячейка</th>
                <th className="font-medium pb-2 px-1 text-right">Кол-во</th>
                <th className="font-medium pb-2 px-1 text-right">Цена</th>
                <th className="font-medium pb-2 px-1 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.items.map((it, i) => (
                <tr key={i}>
                  <td className="py-2.5 px-1">{it.name}</td>
                  <td className="py-2.5 px-1">
                    <Badge tone="muted">
                      <MapPin size={11} /> {it.cell}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-1 text-right tabular-nums">
                    {num(it.qty)} {it.unit}
                  </td>
                  <td className="py-2.5 px-1 text-right tabular-nums text-muted">
                    {money(it.price)}
                  </td>
                  <td className="py-2.5 px-1 text-right tabular-nums font-medium">
                    {money(it.qty * it.price)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td colSpan={4} className="pt-3 px-1 text-right text-muted">
                  Итого
                </td>
                <td className="pt-3 px-1 text-right font-semibold text-base tabular-nums">
                  {money(order.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-line text-sm">
          <span className="flex items-center gap-2 text-muted">
            <Truck size={15} /> {order.courier}
          </span>
          <span className="flex items-center gap-2 text-muted">
            <MapPin size={15} /> {order.address}
          </span>
          {/* Назначение курьера-сотрудника (только для не-курьеров) */}
          {canAssign && couriers.length > 0 && (
            <label className="flex items-center gap-2 ml-auto text-muted">
              <Truck size={15} className="text-brand" />
              <span className="text-[13px]">Курьер:</span>
              <select
                value={order.assignedTo || ''}
                onChange={(e) => assignCourier(order.id, e.target.value || null)}
                className="h-9 px-2 rounded-lg bg-surface-2 border border-line text-[13px] outline-none focus:border-brand"
              >
                <option value="">— не назначен —</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>
      {printOrder && (
        <DocPreviewModal
          doc={printOrder}
          category={printOrder.kind === 'refund' ? 'refund' : 'sale'}
          onClose={() => setPrintOrder(null)}
        />
      )}
      {refundOpen && (
        <RefundModal
          order={order}
          onClose={() => setRefundOpen(false)}
        />
      )}
    </div>
  )
}

// C2: Возврат по чеку. Позволяет вернуть отдельные позиции с указанием
// количества (не больше исходного) и причины. refundOrder в сторе
// делает всю работу: refund-заказ, возврат остатка, moneyTx.
function RefundModal({ order, onClose }) {
  const refundOrder = useStore((s) => s.refundOrder)
  const [items, setItems] = useState(() =>
    (order.items || []).map((it) => ({ productId: it.productId, qty: it.qty })),
  )
  const [reason, setReason] = useState('Возврат покупателя')
  const [err, setErr] = useState('')

  const setQty = (productId, qty) =>
    setItems((s) =>
      s.map((it) => (it.productId === productId ? { ...it, qty: Math.max(0, Number(qty) || 0) } : it)),
    )

  const total = items.reduce((acc, it) => {
    const oi = order.items.find((x) => x.productId === it.productId)
    return acc + Number(it.qty) * Number(oi?.price || 0)
  }, 0)

  // F1-12: guard от двойного клика — refundOrder создаёт refund-order
  // + moneyTx. Двойной submit = двойной возврат денег и склад в минус.
  const submittedRef = useRef(false)
  const submit = () => {
    setErr('')
    if (submittedRef.current) return
    const filtered = items.filter((it) => it.qty > 0)
    if (filtered.length === 0) {
      setErr('Укажите количество хотя бы одной позиции')
      return
    }
    submittedRef.current = true
    const r = refundOrder(order.id, { items: filtered, reason })
    if (r && r.ok === false) {
      setErr(r.error)
      submittedRef.current = false // разрешаем retry после исправления
      return
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Возврат по ${order.no}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={total <= 0}>
            Оформить возврат · {money(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Укажите количество возвращаемых товаров. Деньги вернутся тем же
          способом, что и были получены (наличные / карта / долг клиента).
        </p>
        <Field label="Причина возврата">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Не подошло / брак / …"
          />
        </Field>
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60 text-muted text-[11.5px] uppercase tracking-wide">
              <tr>
                <th className="text-left py-2 px-3">Товар</th>
                <th className="text-right py-2 px-2 w-24">Куплено</th>
                <th className="text-right py-2 px-2 w-28">Вернуть</th>
                <th className="text-right py-2 px-3 w-24">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => {
                const ri = items.find((x) => x.productId === it.productId)
                const sum = Number(ri?.qty || 0) * Number(it.price || 0)
                return (
                  <tr key={it.productId} className="border-t border-line">
                    <td className="py-2 px-3">{it.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted">
                      {num(it.qty)} {it.unit}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        min="0"
                        max={it.qty}
                        value={ri?.qty || 0}
                        onChange={(e) => setQty(it.productId, e.target.value)}
                        className="w-20 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {money(sum)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {err && <div className="text-[13px] text-bad">{err}</div>}
      </div>
    </Modal>
  )
}

// PrintMenu удалён — заменён единой DocPreviewModal (см. state
// printOrder в OrderDetail). Все шаблоны — из lib/templates/sale.
