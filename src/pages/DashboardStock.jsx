// Дашборд для роли «кладовщик» (stock). В отличие от менеджерского —
// не про выручку и маржу, а про операционку смены: что принять, что
// собрать, что заказать поставщику, где расхождения инвентаризации.
//
// Данные берутся из тех же слайсов store, что уже используются в других
// местах — без новых полей. Секции спроектированы «читай сверху вниз»:
// сначала контекст смены, потом плитки «требует внимания», потом два
// списка (Приёмка/Сборка) и правая колонка «заказать поставщику +
// прогресс инвентаризации».
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  ClipboardX,
  MapPin,
  PackagePlus,
  ShoppingBag,
  AlertTriangle,
} from 'lucide-react'
import { Card, Section, Badge, Button, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, plural, relTime } from '../lib/format'
import { reservedByProduct, availableStock } from '../lib/orders'
import { catInfo } from '../lib/constants'

function ContextTile({ label, valueLine }) {
  return (
    <div className="rounded-xl bg-ok-soft border border-ok/25 px-3 py-2">
      <div className="text-[10px] font-semibold text-ok uppercase tracking-wide">{label}</div>
      <div className="text-[13px] text-ink mt-0.5">{valueLine}</div>
    </div>
  )
}

// Плитка «требует внимания». Тон-outline для главной, обычная для остальных.
function ActionTile({ icon: Icon, label, value, sub, tone = 'brand', primary, to }) {
  const body = (
    <div
      className={cx(
        'card p-4 flex items-start gap-3 h-full',
        primary && 'border-brand shadow-lg shadow-brand/10',
      )}
    >
      <div
        className={cx(
          'h-10 w-10 rounded-xl grid place-items-center shrink-0',
          tone === 'brand' && 'bg-brand-soft text-brand',
          tone === 'info' && 'bg-info-soft text-info',
          tone === 'warn' && 'bg-warn-soft text-warn',
          tone === 'ok' && 'bg-ok-soft text-ok',
        )}
      >
        <Icon size={20} strokeWidth={2.1} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-muted">{label}</div>
        <div className="text-[22px] font-semibold leading-tight tracking-tight tabular-nums">
          {value}
        </div>
        {sub && (
          <div className={cx('text-[12px] mt-0.5', primary ? 'text-brand font-semibold' : 'text-muted')}>
            {sub}
          </div>
        )}
      </div>
    </div>
  )
  return to ? <Link to={to} className="block hover:brightness-[1.02] transition">{body}</Link> : body
}

// «Смена» пока считаем по login timestamp: если недавно логинились —
// показываем длительность. В store есть authAt (устанавливается в login),
// если поле отсутствует — плитку не показываем.
function useShiftDuration() {
  const authAt = useStore((s) => s.authAt)
  return useMemo(() => {
    if (!authAt) return null
    const ms = Date.now() - authAt
    if (ms < 60_000) return 'меньше минуты'
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return h ? `${h}ч ${m}м` : `${m}м`
  }, [authAt])
}

export default function DashboardStock() {
  const products = useStore((s) => s.products) || []
  const orders = useStore((s) => s.orders) || []
  const documents = useStore((s) => s.documents) || []
  const purchaseOrders = useStore((s) => s.purchaseOrders) || []
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  const shiftDuration = useShiftDuration()

  // Ожидающие приёмки заказы поставщикам: статус sent (отправлен, ждём
  // товар). Проведённые (received) уже отработаны, черновики (draft) ещё
  // не отправлены.
  const awaitingPO = useMemo(
    () => purchaseOrders.filter((p) => p.status === 'sent').slice(0, 4),
    [purchaseOrders],
  )
  // На сборку: заказы в статусах confirmed/picking (в очередь на сборку).
  const toPick = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'confirmed' || o.status === 'picking')
        .slice(0, 5),
    [orders],
  )
  // Товары ниже минимума — по доступному остатку (учитывая резервы).
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  const lowStock = useMemo(
    () =>
      products
        .filter((p) => (p.type !== 'service') && availableStock(p, reserved) <= (p.minStock || 0))
        .sort((a, b) => availableStock(a, reserved) - availableStock(b, reserved))
        .slice(0, 4),
    [products, reserved],
  )
  const lowStockTotal = products.filter(
    (p) => (p.type !== 'service') && availableStock(p, reserved) <= (p.minStock || 0),
  ).length
  // Инвентаризации: черновики со статусом draft (недосведённые).
  const invDrafts = documents.filter((d) => d.type === 'inventory' && d.status === 'draft')
  // Считаем принято за смену: любые документы, где me — автор, за смену.
  const acceptedThisShift = useMemo(() => {
    const from = useStore.getState().authAt || 0
    if (!from) return 0
    return documents.filter(
      (d) => d.by === authUserId && d.type === 'purchase' && d.status === 'posted' && d.createdAt >= from,
    ).length
  }, [documents, authUserId])

  const totalToPickValue = toPick.reduce((a, o) => a + (o.total || 0), 0)

  return (
    <div className="animate-fadeUp space-y-5">
      {/* Приветствие + краткий саммари дня */}
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Смена {me?.name?.split(' ')[0] || 'кладовщика'}
          </h2>
          <p className="text-[13px] text-muted mt-1">
            {shiftDuration
              ? `Открыта ${shiftDuration} назад · сегодня `
              : 'Сегодня '}
            <b className="text-ink">{acceptedThisShift} принято</b>
            {toPick.length ? <>, <b className="text-ink">{toPick.length} к сборке</b></> : null}
            {lowStockTotal ? <>, <b className="text-warn">{lowStockTotal} SKU ниже минимума</b></> : null}
          </p>
        </div>
        {shiftDuration && (
          <ContextTile
            label="Смена открыта"
            valueLine={<>{shiftDuration} · <b>принято {acceptedThisShift}</b></>}
          />
        )}
      </div>

      {/* Требует внимания */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ActionTile
          icon={PackagePlus}
          label="Ожидают приёмки"
          value={awaitingPO.length ? `${awaitingPO.length} PO` : '—'}
          sub={awaitingPO.length ? '→ принять' : 'заказы поставщикам не ждут'}
          tone="brand"
          primary={awaitingPO.length > 0}
          to="/purchase-orders"
        />
        <ActionTile
          icon={ClipboardCheck}
          label="На сборке"
          value={toPick.length}
          sub={toPick.length ? `на ${money(totalToPickValue)}` : 'сборок нет'}
          tone="info"
          to="/orders?filter=picking"
        />
        <ActionTile
          icon={AlertTriangle}
          label="Ниже минимума"
          value={lowStockTotal ? `${lowStockTotal} SKU` : 'ок'}
          sub={lowStockTotal ? 'пора пополнить' : 'запаса хватит'}
          tone="warn"
          to="/products?filter=low"
        />
        <ActionTile
          icon={ClipboardX}
          label="Черновики инвентаризации"
          value={invDrafts.length || '—'}
          sub={invDrafts.length ? 'закрыть до конца смены' : 'ничего не висит'}
          tone="ok"
          to="/operations"
        />
      </div>

      {/* Два списка: Приёмка + На сборку */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          title={
            <span className="flex items-center gap-2">
              <PackagePlus size={16} className="text-brand" /> Приёмка сегодня
            </span>
          }
          subtitle="Заказы поставщикам, ожидающие проведения приёмки"
          className="lg:col-span-2"
        >
          {awaitingPO.length === 0 ? (
            <div className="py-8 text-center text-muted text-[13px]">
              Всё принято. Новые заказы поставщикам появятся здесь.
            </div>
          ) : (
            <ul className="divide-y divide-line -mx-5">
              {awaitingPO.map((p) => (
                <li key={p.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                    <ShoppingBag size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {p.no} · {p.supplierName || 'Без поставщика'}
                    </div>
                    <div className="text-[12px] text-muted">
                      {(p.items || []).length} {plural((p.items || []).length, ['позиция', 'позиции', 'позиций'])}
                      {p.total ? ` · ${money(p.total)}` : ''}
                      {p.sentAt ? ` · отправлен ${relTime(p.sentAt)}` : ''}
                    </div>
                  </div>
                  <Link to={`/purchase-orders?id=${p.id}`}>
                    <Button size="sm">Принять →</Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-warn" /> Заказать поставщику
            </span>
          }
          subtitle={lowStockTotal ? `${lowStockTotal} SKU ниже минимума` : 'запаса хватит'}
        >
          {lowStock.length === 0 ? (
            <div className="py-6 text-center text-muted text-[13px]">
              Все товары в норме.
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {lowStock.map((p) => {
                  const cat = catInfo(p.category)
                  const avail = availableStock(p, reserved)
                  return (
                    <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 bg-surface-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.color }} />
                      <span className="text-[12.5px] text-ink flex-1 truncate">{p.name}</span>
                      <span
                        className={cx(
                          'text-[11px] font-semibold tabular-nums shrink-0',
                          avail === 0 ? 'text-bad' : 'text-warn',
                        )}
                      >
                        {num(avail)} / {num(p.minStock || 0)}
                      </span>
                    </li>
                  )
                })}
                {lowStockTotal > lowStock.length && (
                  <li className="rounded-lg px-2 py-1.5 bg-surface-2 text-[12px] text-muted">
                    и ещё <b className="text-ink">{lowStockTotal - lowStock.length} SKU</b>
                  </li>
                )}
              </ul>
              <Link to="/purchase-orders" className="mt-3 block">
                <Button variant="soft" className="w-full" icon={ArrowRight}>
                  Открыть закупки
                </Button>
              </Link>
            </>
          )}
        </Section>
      </div>

      {/* На сборку — отдельным блоком, с полным списком */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-info" /> На сборку
          </span>
        }
        subtitle={toPick.length ? `${toPick.length} заказов, ${money(totalToPickValue)}` : 'сборок нет'}
        action={
          <Link to="/orders">
            <Button size="sm" variant="soft" icon={ArrowRight}>
              Все заказы
            </Button>
          </Link>
        }
      >
        {toPick.length === 0 ? (
          <div className="py-6 text-center text-muted text-[13px]">
            Ничего не ждёт сборки.
          </div>
        ) : (
          <ul className="divide-y divide-line -mx-5">
            {toPick.map((o) => {
              const blocked = o.paymentStatus === 'unpaid' && !o.allowCredit
              return (
                <li key={o.id} className="px-5 py-3 flex items-center gap-3">
                  <div
                    className={cx(
                      'h-9 w-9 rounded-lg grid place-items-center shrink-0 text-[11px] font-semibold tabular-nums',
                      o.status === 'picking' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info',
                    )}
                  >
                    {o.no?.slice(-4) || '…'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {o.customerName || 'Клиент'} ·{' '}
                      {(o.items || []).length} {plural((o.items || []).length, ['позиция', 'позиции', 'позиций'])}
                    </div>
                    <div className="text-[12px] text-muted truncate">
                      {money(o.total || 0)}
                      {blocked ? ' · ждёт оплаты — не собирать' : ''}
                    </div>
                  </div>
                  {blocked ? (
                    <Badge tone="muted">Заблокировано</Badge>
                  ) : (
                    <Link to={`/orders?id=${o.id}`}>
                      <Button size="sm">Собрать →</Button>
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}
