// Заказы поставщикам (Purchase Orders). Pre-документ до фактической
// приёмки товара. Флоу: draft → sent → received → closed / cancelled.
// «Получено» вызывает addDocument(type='purchase') — движок posting.js
// оприходует остатки по FIFO, а PO связывается с созданным документом.
import { useMemo, useState } from 'react'
import {
  Truck,
  Plus,
  Send,
  Check,
  X,
  Trash2,
  Search,
  FileEdit,
  Package,
} from 'lucide-react'
import {
  Card,
  Button,
  Badge,
  Field,
  Input,
  Select,
  Modal,
  Empty,
  cx,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'

const STATUS_INFO = {
  draft: { label: 'Черновик', tone: 'warn' },
  sent: { label: 'Отправлен', tone: 'info' },
  received: { label: 'Получен', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'brand' },
  cancelled: { label: 'Отменён', tone: 'bad' },
}

const STATUS_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'draft', label: 'Черновик' },
  { key: 'sent', label: 'Отправлен' },
  { key: 'received', label: 'Получен' },
  { key: 'cancelled', label: 'Отменён' },
]

export default function PurchaseOrders() {
  const purchaseOrders = useStore((s) => s.purchaseOrders) || []
  const suppliers = useStore((s) => s.suppliers) || []
  const products = useStore((s) => s.products) || []
  const addPurchaseOrder = useStore((s) => s.addPurchaseOrder)
  const updatePurchaseOrder = useStore((s) => s.updatePurchaseOrder)
  const sendPurchaseOrder = useStore((s) => s.sendPurchaseOrder)
  const receivePurchaseOrder = useStore((s) => s.receivePurchaseOrder)
  const cancelPurchaseOrder = useStore((s) => s.cancelPurchaseOrder)
  const removePurchaseOrder = useStore((s) => s.removePurchaseOrder)

  const [modal, setModal] = useState(null) // null | { id? }
  const [filter, setFilter] = useState('all')
  const [receiveErr, setReceiveErr] = useState('')

  const list = useMemo(
    () =>
      purchaseOrders
        .filter((p) => filter === 'all' || p.status === filter)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [purchaseOrders, filter],
  )

  const stats = useMemo(() => {
    const s = { draft: 0, sent: 0, received: 0 }
    for (const p of purchaseOrders) if (s[p.status] != null) s[p.status]++
    return s
  }, [purchaseOrders])

  const editPO = list.find((p) => p.id === modal?.id) || null

  const onReceive = (po) => {
    setReceiveErr('')
    const r = receivePurchaseOrder(po.id)
    if (r && typeof r === 'object' && r.ok === false) {
      setReceiveErr(`${po.no}: ${r.error}`)
    }
  }

  return (
    <div className="animate-fadeUp space-y-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Заказы поставщикам
          </h2>
          <p className="text-sm text-muted">
            Планируйте закупку заранее: черновик → отправлен поставщику →
            приняли товар (создастся Покупка, остатки увеличатся).
          </p>
        </div>
        <Button
          icon={Plus}
          className="ml-auto"
          onClick={() => setModal({ id: null })}
        >
          Новый заказ
        </Button>
      </div>

      {/* Фильтр по статусу */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {STATUS_FILTERS.map((s) => {
          const c = s.key !== 'all' ? stats[s.key] : purchaseOrders.length
          return (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              className={cx(
                'flex items-center gap-2 px-3.5 h-9 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
                filter === s.key
                  ? 'bg-brand text-brand-ink'
                  : 'bg-surface-2 text-muted hover:text-ink',
              )}
            >
              {s.label}
              {c > 0 && (
                <span className="text-[11px] opacity-70 tabular-nums">
                  {c}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {receiveErr && (
        <div className="rounded-xl bg-bad-soft text-bad text-[13px] px-3 py-2">
          {receiveErr}
        </div>
      )}

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <Empty
            icon={Truck}
            title={
              filter === 'all'
                ? 'Пока нет заказов поставщикам'
                : 'Ничего с этим статусом'
            }
            text={
              filter === 'all'
                ? 'Нажмите «Новый заказ», чтобы создать первый.'
                : 'Смените фильтр.'
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {list.map((p) => (
              <PORow
                key={p.id}
                po={p}
                onEdit={() => setModal({ id: p.id })}
                onSend={() => sendPurchaseOrder(p.id)}
                onReceive={() => onReceive(p)}
                onCancel={() => {
                  if (confirm(`Отменить заказ ${p.no}?`))
                    cancelPurchaseOrder(p.id)
                }}
                onDelete={() => {
                  if (confirm(`Удалить заказ ${p.no}? (безвозвратно)`))
                    removePurchaseOrder(p.id)
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {modal && (
        <POModal
          po={editPO}
          suppliers={suppliers}
          products={products}
          onClose={() => setModal(null)}
          onSubmit={(data) => {
            if (editPO) updatePurchaseOrder(editPO.id, data)
            else addPurchaseOrder(data)
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

function PORow({ po, onEdit, onSend, onReceive, onCancel, onDelete }) {
  const info = STATUS_INFO[po.status] || STATUS_INFO.draft
  const editable = po.status === 'draft'
  const canSend = po.status === 'draft'
  const canReceive = po.status === 'draft' || po.status === 'sent'
  const canCancel = po.status !== 'received' && po.status !== 'cancelled'
  const canDelete = po.status === 'draft' || po.status === 'cancelled'

  return (
    <div className="p-4 flex items-start gap-3 flex-wrap">
      <div
        className={cx(
          'h-10 w-10 rounded-lg grid place-items-center shrink-0',
          info.tone === 'ok'
            ? 'bg-ok-soft text-ok'
            : info.tone === 'info'
              ? 'bg-info-soft text-info'
              : info.tone === 'bad'
                ? 'bg-bad-soft text-bad'
                : info.tone === 'brand'
                  ? 'bg-brand-soft text-brand'
                  : 'bg-warn-soft text-warn',
        )}
      >
        <Truck size={19} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[14px]">{po.no}</span>
          <Badge tone={info.tone} className="text-[10px]">
            {info.label}
          </Badge>
          <span className="text-[13px] text-muted truncate">
            · {po.supplierName || '—'}
          </span>
        </div>
        <div className="text-[12px] text-muted mt-0.5">
          {po.items?.length || 0} поз. на {money(po.total || 0)}
          {po.expectedAt && ` · ожидается ${new Date(po.expectedAt).toLocaleDateString('ru-RU')}`}
          {po.note && ` · ${po.note}`}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {editable && (
          <Button size="sm" variant="soft" icon={FileEdit} onClick={onEdit}>
            Править
          </Button>
        )}
        {canSend && (
          <Button size="sm" variant="soft" icon={Send} onClick={onSend}>
            Отправить
          </Button>
        )}
        {canReceive && (
          <Button size="sm" icon={Check} onClick={onReceive}>
            Принять товар
          </Button>
        )}
        {canCancel && (
          <button
            onClick={onCancel}
            className="text-muted hover:text-bad p-1.5"
            title="Отменить"
          >
            <X size={16} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="text-muted hover:text-bad p-1.5"
            title="Удалить"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

function POModal({ po, suppliers, products, onClose, onSubmit }) {
  const [supplierId, setSupplierId] = useState(po?.supplierId || suppliers[0]?.id || '')
  const [expectedAt, setExpectedAt] = useState(
    po?.expectedAt ? po.expectedAt.slice(0, 10) : '',
  )
  const [note, setNote] = useState(po?.note || '')
  const [items, setItems] = useState(po?.items?.map((it) => ({ ...it })) || [])
  const [q, setQ] = useState('')

  const round3 = (n) => Math.round(n * 1000) / 1000

  const candidates = products
    .filter((p) => (p.type || 'product') === 'product')
    .filter((p) => {
      const s = q.trim().toLowerCase()
      return (
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku?.toLowerCase().includes(s)
      )
    })
    .slice(0, 6)

  const addItem = (p) => {
    setItems((prev) =>
      prev.find((x) => x.productId === p.id)
        ? prev.map((x) =>
            x.productId === p.id ? { ...x, qty: round3(x.qty + 1) } : x,
          )
        : [
            ...prev,
            {
              productId: p.id,
              name: p.name,
              unit: p.unit,
              qty: 1,
              cost: Number(p.cost) || 0,
            },
          ],
    )
    setQ('')
  }
  const setQty = (id, qty) =>
    setItems((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )
  const setCost = (id, cost) =>
    setItems((r) =>
      r.map((x) =>
        x.productId === id ? { ...x, cost: Math.max(0, Number(cost) || 0) } : x,
      ),
    )

  const total = items.reduce(
    (a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0),
    0,
  )

  const submit = () => {
    const sup = suppliers.find((s) => s.id === supplierId)
    onSubmit({
      supplierId,
      supplierName: sup?.name,
      items,
      expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
      note,
    })
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Truck size={18} className="text-brand" />
          {po ? `Правка ${po.no}` : 'Новый заказ поставщику'}
        </span>
      }
    >
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Поставщик">
            <Select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ожидаемая дата">
            <Input
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">Товары</span>
            <span className="text-[11px] text-muted">
              {items.length ? `${items.length} поз. на ${money(total)}` : ''}
            </span>
          </div>
          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((it) => (
                <div
                  key={it.productId}
                  className="flex items-center gap-2 p-2 rounded-lg bg-surface"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {it.name}
                    </div>
                    <div className="text-[11px] text-muted">
                      × {money(it.cost)}/{it.unit}
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0.001"
                    step="1"
                    value={it.qty}
                    onChange={(e) => setQty(it.productId, +e.target.value)}
                    className="w-20 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-center"
                  />
                  <span className="text-[12px] text-muted w-8">{it.unit}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.cost}
                    onChange={(e) => setCost(it.productId, e.target.value)}
                    className="w-24 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-right"
                  />
                  <span className="text-[12px] text-muted w-6 text-right">₽</span>
                  <span className="text-[13px] font-semibold tabular-nums w-24 text-right">
                    {money((Number(it.qty) || 0) * (Number(it.cost) || 0))}
                  </span>
                  <button
                    onClick={() => setQty(it.productId, 0)}
                    className="text-muted hover:text-bad"
                    title="Убрать"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти товар для добавления в заказ…"
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-line text-[13px] outline-none focus:border-brand"
            />
            {q && candidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 card p-1 max-h-56 overflow-y-auto">
                {candidates.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addItem(p)}
                    className="w-full flex items-center justify-between gap-2 px-2 h-9 rounded-md hover:bg-surface-2 text-left text-[13px]"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted text-[11px] shrink-0">
                      {p.sku} · закуп {money(p.cost)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <Field label="Комментарий">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Опционально"
          />
        </Field>

        <div className="flex justify-between items-center pt-1">
          <div className="text-sm text-muted">
            Итого <b className="text-ink tabular-nums">{money(total)}</b>
          </div>
          <div className="flex gap-2">
            <Button
              icon={Check}
              disabled={!items.length || !supplierId}
              onClick={submit}
            >
              {po ? 'Сохранить' : 'Создать'}
            </Button>
            <Button variant="soft" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
