// Реестр складских документов: закупки, продажи, возвраты, перемещения,
// списания, инвентаризации. Черновики можно провести или удалить;
// проведённые — отменить (с откатом остатка).
import { useState } from 'react'
import { Ban, Check, FileText, Printer, Trash2 } from 'lucide-react'
import { Card, Button, Badge, Empty, cx } from '../../components/ui'
import { useConfirm } from '../../components/Confirm'
import { useStore } from '../../store/useStore'
import { num, relTime } from '../../lib/format'
import { docTypeInfo, DOC_STATUS } from '../../lib/constants'
import { DOC_ICON } from './_shared'
import DocPreviewModal from '../../components/DocPreviewModal'

const REG_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'posted', label: 'Проведённые' },
  { key: 'draft', label: 'Черновики' },
  { key: 'cancelled', label: 'Отменённые' },
]

// Категорию для превью-модалки выбираем по типу документа: покупки и
// оприходование печатаются как «Приёмный акт», продажи — как счёт/
// накладная, остальное — универсальным stock-шаблоном.
function categoryFor(doc) {
  if (doc.type === 'sale') return 'sale'
  if (doc.type === 'purchase' || doc.type === 'stockin') return 'purchase'
  return 'stock'
}

export default function DocumentsTab() {
  const documents = useStore((s) => s.documents) || []
  const employees = useStore((s) => s.employees) || []
  const postDocument = useStore((s) => s.postDocument)
  const cancelDocument = useStore((s) => s.cancelDocument)
  const removeDocument = useStore((s) => s.removeDocument)
  const [filter, setFilter] = useState('all')
  const [printDoc, setPrintDoc] = useState(null)
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || 'Система'
  const confirm = useConfirm()
  const askCancel = async (d) => {
    const ti = docTypeInfo(d.type)
    const ok = await confirm({
      title: `Отменить документ ${d.no}?`,
      body: `${ti.label} будет отменён, остатки откатятся к состоянию «до проведения».`,
      tone: 'warning',
      okLabel: 'Отменить документ',
      cancelLabel: 'Оставить',
    })
    if (ok) cancelDocument(d.id)
  }
  const askRemove = async (d) => {
    const ok = await confirm({
      title: `Удалить документ ${d.no}?`,
      body: 'Документ удалится безвозвратно. Только для черновиков и отменённых.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) removeDocument(d.id)
  }

  const list = filter === 'all' ? documents : documents.filter((d) => d.status === filter)

  if (!documents.length) {
    return (
      <Empty
        icon={FileText}
        title="Документов нет"
        text="Создайте закупку, списание, перемещение или другой документ — он появится в реестре с номером и статусом."
      />
    )
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
        {REG_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              'px-3 h-9 rounded-lg text-[13px] font-medium whitespace-nowrap',
              filter === f.key ? 'bg-surface-3 text-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={FileText} title="Ничего не найдено" />
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {list.map((d) => {
              const ti = docTypeInfo(d.type)
              const st = DOC_STATUS[d.status] || DOC_STATUS.posted
              const Icon = DOC_ICON[d.type] || FileText
              return (
                <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div
                    className={cx(
                      'h-9 w-9 rounded-lg grid place-items-center shrink-0',
                      d.status === 'cancelled' ? 'bg-surface-2 text-muted' : 'bg-brand-soft text-brand',
                    )}
                  >
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {d.no} · {ti.label}
                    </div>
                    <div className="text-[12px] text-muted">
                      {relTime(d.createdAt)} · {nameOf(d.by)} · {(d.items || []).length} поз. · {num(d.totalQty)} ед.
                    </div>
                  </div>
                  <Badge tone={st.color}>{st.label}</Badge>
                  <div className="flex items-center gap-1">
                    {d.status === 'draft' && (
                      <Button size="sm" variant="primary" icon={Check} onClick={() => postDocument(d.id)}>
                        Провести
                      </Button>
                    )}
                    {d.status === 'posted' && (
                      <Button size="sm" variant="ghost" icon={Ban} onClick={() => askCancel(d)}>
                        Отменить
                      </Button>
                    )}
                    <Button size="sm" variant="soft" icon={Printer} onClick={() => setPrintDoc(d)}>
                      Печать
                    </Button>
                    {d.status !== 'posted' && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => askRemove(d)} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
      {printDoc && (
        <DocPreviewModal
          doc={printDoc}
          category={categoryFor(printDoc)}
          onClose={() => setPrintDoc(null)}
        />
      )}
    </div>
  )
}
