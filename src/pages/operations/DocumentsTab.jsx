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

const REG_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'posted', label: 'Проведённые' },
  { key: 'draft', label: 'Черновики' },
  { key: 'cancelled', label: 'Отменённые' },
]

// Печать одного документа в отдельном окне — компактная форма без
// НДС/подписей (для этого есть ТОРГ-12/УПД из заказов).
function printDocument(doc, byName) {
  const ti = docTypeInfo(doc.type)
  const rows = (doc.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${it.name}</td><td style="text-align:right">${it.qty}</td><td>${it.unit || ''}</td></tr>`,
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${doc.no}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;padding:32px;}
      h1{font-size:20px;margin:0 0 4px}.muted{color:#666;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}
      th,td{border:1px solid #ccc;padding:8px 10px;text-align:left}th{background:#f3f3f3}
      .foot{margin-top:24px;font-size:13px;color:#444}
    </style></head><body>
    <h1>${ti.label} № ${doc.no}</h1>
    <div class="muted">${new Date(doc.createdAt).toLocaleString('ru-RU')} · ${byName}${doc.reason ? ' · ' + doc.reason : ''}</div>
    <table><thead><tr><th>#</th><th>Наименование</th><th style="text-align:right">Кол-во</th><th>Ед.</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="foot">Позиций: ${(doc.items || []).length} · Всего: ${doc.totalQty} · Статус: ${(DOC_STATUS[doc.status] || {}).label || doc.status}</div>
    </body></html>`
  const w = window.open('', '_blank', 'width=720,height=900')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}

export default function DocumentsTab() {
  const documents = useStore((s) => s.documents) || []
  const employees = useStore((s) => s.employees) || []
  const postDocument = useStore((s) => s.postDocument)
  const cancelDocument = useStore((s) => s.cancelDocument)
  const removeDocument = useStore((s) => s.removeDocument)
  const [filter, setFilter] = useState('all')
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
                    <Button size="sm" variant="soft" icon={Printer} onClick={() => printDocument(d, nameOf(d.by))}>
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
    </div>
  )
}
