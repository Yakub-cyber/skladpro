// Заказы поставщикам (Purchase Orders). Pre-документ до фактической
// приёмки. Флоу: draft → sent → received → closed / cancelled.
// «Получено» вызывает addDocument(type='purchase') — движок posting.js
// оприходует остатки по FIFO, а PO связывается с созданным документом.
import { useMemo, useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import { Button, Card, Empty, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { useConfirm } from '@/shared/components/Confirm'
import DocPreviewModal from '@/shared/components/DocPreviewModal'
import POModal from './components/POModal'
import PORow from './components/PORow'

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
  const confirm = useConfirm()

  const [modal, setModal] = useState(null) // null | { id? }
  const [filter, setFilter] = useState('all')
  const [receiveErr, setReceiveErr] = useState('')
  const [printPO, setPrintPO] = useState(null)

  const askCancelPO = async (p) => {
    const ok = await confirm({
      title: `Отменить заказ поставщику ${p.no}?`,
      body: 'Заказ помечается отменённым. На остатки товаров это не влияет.',
      tone: 'warning',
      okLabel: 'Отменить заказ',
    })
    if (ok) cancelPurchaseOrder(p.id)
  }
  const askRemovePO = async (p) => {
    const ok = await confirm({
      title: `Удалить заказ ${p.no}?`,
      body: 'Действие необратимо — восстановить будет нельзя.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) removePurchaseOrder(p.id)
  }

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
          <h2 className="text-xl font-semibold tracking-tight">Заказы поставщикам</h2>
          <p className="text-sm text-muted">
            Планируйте закупку заранее: черновик → отправлен поставщику →
            приняли товар (создастся Покупка, остатки увеличатся).
          </p>
        </div>
        <Button icon={Plus} className="ml-auto" onClick={() => setModal({ id: null })}>
          Новый заказ
        </Button>
      </div>

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
              {c > 0 && <span className="text-[11px] opacity-70 tabular-nums">{c}</span>}
            </button>
          )
        })}
      </div>

      {receiveErr && (
        <div className="rounded-xl bg-bad-soft text-bad text-[13px] px-3 py-2">{receiveErr}</div>
      )}

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <Empty
            icon={Truck}
            title={filter === 'all' ? 'Пока нет заказов поставщикам' : 'Ничего с этим статусом'}
            text={filter === 'all' ? 'Нажмите «Новый заказ», чтобы создать первый.' : 'Смените фильтр.'}
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
                onCancel={() => askCancelPO(p)}
                onDelete={() => askRemovePO(p)}
                onPrint={() => setPrintPO(p)}
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
      {printPO && (
        <DocPreviewModal doc={printPO} category="purchaseOrder" onClose={() => setPrintPO(null)} />
      )}
    </div>
  )
}
