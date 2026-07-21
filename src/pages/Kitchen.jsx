// Экран «Кухня» — рабочее место повара. Показывает активные заказы
// столов (order.status='open' с tableId) сгруппированные по столу.
// В каждом столе — список позиций с их статусом на кухне:
//   pending — «в работе», повар видит и готовит
//   ready   — «готово», ждёт официанта, чтобы отнести
//   served  — «отдано» гостю (скрываем из основного вида)
//
// Кнопки перемещают позицию между колонками. Список сам обновляется
// (Zustand-подписки перерисовывают компонент при любой смене orders).
import { useMemo, useState } from 'react'
import { UtensilsCrossed, Check, Bell, Timer, Package } from 'lucide-react'
import { Card, Button, Badge, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, relTime } from '../lib/format'

// Помощник: ключ строки — тот же, что в NewOrder (product + модификаторы).
function rowKeyOf(it) {
  return (
    it.productId +
    '|' +
    (it.modifiers || []).map((m) => m.optionId).sort().join(',')
  )
}

export default function Kitchen() {
  const orders = useStore((s) => s.orders) || []
  const tables = useStore((s) => s.tables) || []
  const setKitchenStatus = useStore((s) => s.setKitchenStatus)

  const [showServed, setShowServed] = useState(false)

  // Активные заказы столов: status='open' и tableId задан.
  const activeOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'open' && o.tableId)
        .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)),
    [orders],
  )

  const tableOf = (tableId) => tables.find((t) => t.id === tableId)

  // Разложение позиций всех активных заказов по статусам.
  const pending = []
  const ready = []
  const served = []
  for (const o of activeOrders) {
    for (const it of o.items || []) {
      const st = it.kitchenStatus || 'pending'
      const entry = { order: o, item: it, key: rowKeyOf(it), table: tableOf(o.tableId) }
      if (st === 'ready') ready.push(entry)
      else if (st === 'served') served.push(entry)
      else pending.push(entry)
    }
  }

  if (!activeOrders.length) {
    return (
      <div className="animate-fadeUp">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Кухня</h2>
          <p className="text-sm text-muted">
            Активные заказы столов появятся здесь автоматически.
          </p>
        </div>
        <Empty
          icon={UtensilsCrossed}
          title="Нет активных заказов"
          text="Как только за столом закажут первую позицию — она появится в очереди."
        />
      </div>
    )
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Кухня
            <Badge tone="brand">{pending.length + ready.length}</Badge>
          </h2>
          <p className="text-sm text-muted">
            В работе: <b>{pending.length}</b> · Готово: <b>{ready.length}</b>
            {served.length > 0 && (
              <> · Отдано за смену: <b>{served.length}</b></>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input
            type="checkbox"
            checked={showServed}
            onChange={(e) => setShowServed(e.target.checked)}
            className="accent-[var(--brand)] w-4 h-4"
          />
          Показать отданные
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Колонка «В работе» */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Timer size={16} className="text-warn" />
            <h3 className="font-semibold">В работе</h3>
            <Badge tone="warn">{pending.length}</Badge>
          </div>
          {pending.length === 0 ? (
            <Card className="p-6 text-center text-muted text-sm">
              Всё готово — очередь пуста.
            </Card>
          ) : (
            <div className="space-y-2">
              {pending.map((e) => (
                <KitchenRow
                  key={e.order.id + '|' + e.key}
                  entry={e}
                  primaryLabel="Готово"
                  primaryIcon={Check}
                  primaryTone="ok"
                  onPrimary={() => setKitchenStatus(e.order.id, e.key, 'ready')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Колонка «Готово — ждёт официанта» */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Bell size={16} className="text-ok" />
            <h3 className="font-semibold">Готово к подаче</h3>
            <Badge tone="ok">{ready.length}</Badge>
          </div>
          {ready.length === 0 ? (
            <Card className="p-6 text-center text-muted text-sm">
              Пока ничего не готово к отдаче.
            </Card>
          ) : (
            <div className="space-y-2">
              {ready.map((e) => (
                <KitchenRow
                  key={e.order.id + '|' + e.key}
                  entry={e}
                  primaryLabel="Отдано"
                  primaryIcon={Package}
                  primaryTone="brand"
                  onPrimary={() => setKitchenStatus(e.order.id, e.key, 'served')}
                  onSecondary={() => setKitchenStatus(e.order.id, e.key, 'pending')}
                  secondaryLabel="Вернуть в работу"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Отданные — свернуто по умолчанию */}
      {showServed && served.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <Check size={16} className="text-muted" />
            <h3 className="font-semibold text-muted">Отдано</h3>
            <Badge tone="muted">{served.length}</Badge>
          </div>
          <div className="space-y-2 opacity-70">
            {served.map((e) => (
              <KitchenRow
                key={e.order.id + '|' + e.key}
                entry={e}
                primaryLabel="Вернуть в готовые"
                primaryIcon={Bell}
                primaryTone="soft"
                onPrimary={() => setKitchenStatus(e.order.id, e.key, 'ready')}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KitchenRow({
  entry,
  primaryLabel,
  primaryIcon,
  primaryTone,
  onPrimary,
  onSecondary,
  secondaryLabel,
}) {
  const { order, item, table } = entry
  const price = Number(item.price) || 0
  return (
    <Card className="p-3 flex items-start gap-3">
      {/* Стол — крупный номер, чтобы повар/официант сразу понял «куда» */}
      <div className="h-12 w-12 rounded-xl bg-brand-soft text-brand grid place-items-center shrink-0 font-bold text-lg">
        {table?.no ?? '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[14px]">{item.name}</span>
          <span className="text-[12px] text-muted">
            × {num(item.qty)} {item.unit || ''}
          </span>
          <span className="ml-auto text-[12px] text-muted tabular-nums">
            {money(item.qty * price)}
          </span>
        </div>
        {/* Модификаторы блюда — то, что повар должен приготовить особым образом */}
        {(item.modifiers || []).length > 0 && (
          <ul className="mt-1 space-y-0.5 pl-2 border-l-2 border-info/50">
            {item.modifiers.map((m) => (
              <li key={m.optionId} className="text-[12px] text-muted">
                <span className="opacity-70">{m.groupName}:</span>{' '}
                <span className="text-ink font-medium">{m.name}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="text-[11px] text-muted mt-1">
          Заказ {order.no} · открыт {relTime(order.createdAt)}
        </div>
        <div className="flex gap-2 mt-2">
          <Button
            size="sm"
            variant={primaryTone === 'soft' ? 'soft' : primaryTone === 'brand' ? 'primary' : 'primary'}
            icon={primaryIcon}
            onClick={onPrimary}
            className={cx(
              primaryTone === 'ok' && 'bg-[var(--ok,#16a34a)] text-white hover:brightness-110',
            )}
          >
            {primaryLabel}
          </Button>
          {onSecondary && (
            <Button size="sm" variant="ghost" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
