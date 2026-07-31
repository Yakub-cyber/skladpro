// Единая модалка предпросмотра печати. Заменяет прямые вызовы
// printInvoiceXxx / printInvoice / printDocument.
//
// Как открыть:
//   <DocPreviewModal
//     doc={order|document|purchaseOrder|moneyTx}
//     category="sale|purchase|purchaseOrder|moneyIn|moneyOut|moneyTransfer|stock"
//     onClose={...}
//   />
//
// В модалке:
//   - селектор шаблона (например для sale → Счёт / ТОРГ-12 / УПД / чек)
//   - редактируемые поля «Директор», «Бухгалтер», «Дата», «Комментарий» —
//     оверрайдят реквизиты ТОЛЬКО на эту печать (в settings.requisites
//     не пишем)
//   - iframe A4 с готовым HTML (реактивный на смену шаблона/полей)
//   - кнопка «Печать» — открывает системный диалог печати из iframe
import { useMemo, useRef, useState, useEffect } from 'react'
import { Printer, ExternalLink } from 'lucide-react'
import { Button, Field, Input, Select, cx } from '@/shared/ui'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/useStore'
import { PRINT_CSS } from '../lib/print/print'
import { ctxFromStore, renderTemplate, TEMPLATES, printFrame, detectCategory } from '../lib/print/printCore'

export default function DocPreviewModal({ doc, category, onClose }) {
  const state = useStore.getState()
  const cat = category || detectCategory(doc)
  const templates = TEMPLATES[cat] || TEMPLATES.stock
  const [tplKey, setTplKey] = useState(templates[0]?.key)
  const [director, setDirector] = useState('')
  const [accountant, setAccountant] = useState('')
  const [dateOverride, setDateOverride] = useState('')
  const [comment, setComment] = useState('')
  const iframeRef = useRef(null)

  // Ctx с оверрайдами. Только для этого рендера — settings в сторе не
  // трогаем, чтобы юзер не «случайно сохранил тестового директора».
  const ctx = useMemo(() => {
    const base = ctxFromStore(state, doc)
    return {
      ...base,
      requisites: {
        ...base.requisites,
        ...(director && { director }),
        ...(accountant && { accountant }),
      },
    }
  }, [state, doc, director, accountant])

  // Документ с оверрайдами даты и комментария.
  const patchedDoc = useMemo(() => {
    const p = { ...doc }
    if (dateOverride) p.createdAt = new Date(dateOverride).toISOString()
    if (comment) p.note = comment
    return p
  }, [doc, dateOverride, comment])

  const bodyHtml = useMemo(
    () => renderTemplate(cat, tplKey, patchedDoc, ctx),
    [cat, tplKey, patchedDoc, ctx],
  )

  // Обновляем содержимое iframe при каждом изменении bodyHtml.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    // Записываем документ через blob-URL — это чище чем srcDoc и не
    // ломает относительные ссылки (у нас их и нет). А главное — из
    // window.print() будет печататься именно iframe контент.
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>${PRINT_CSS}
html,body{background:white}
body{padding:14mm}
@media screen{body{max-width:210mm;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.12)}}
</style></head><body>${bodyHtml}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    iframe.src = url
    return () => URL.revokeObjectURL(url)
  }, [bodyHtml])

  const doPrint = () => {
    // Печатаем через открытое окно (printFrame) — надёжнее чем
    // iframe.contentWindow.print() в браузерах со строгим popup-policy.
    const title =
      (templates.find((t) => t.key === tplKey)?.label || 'Документ') +
      ' ' + (doc.no || '')
    printFrame({ title, bodyHtml })
  }

  const openNewTab = () => {
    // Открыть предпросмотр в новой вкладке — без автопечати. Удобно
    // когда пользователь хочет сохранить как PDF через системный диалог.
    printFrame({ title: 'Предпросмотр', bodyHtml })
  }

  const title = `Печать: ${doc.no || 'документ'}`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className={cx(
          'card w-full flex flex-col max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)]',
          'max-w-5xl animate-fadeUp',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
          <h3 className="font-semibold flex items-center gap-2">
            <Printer size={18} className="text-brand" /> {title}
          </h3>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-surface-2"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Левая колонка — параметры печати */}
          <div className="lg:w-[280px] p-4 space-y-3 border-b lg:border-b-0 lg:border-r border-line overflow-y-auto">
            {templates.length > 1 && (
              <Field label="Шаблон">
                <Select value={tplKey} onChange={(e) => setTplKey(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Дата документа">
              <Input
                type="date"
                value={dateOverride}
                onChange={(e) => setDateOverride(e.target.value)}
                placeholder="как в документе"
              />
            </Field>
            <Field label="Директор (подпись)">
              <Input
                value={director}
                onChange={(e) => setDirector(e.target.value)}
                placeholder={ctx.requisites?.director || 'из реквизитов'}
              />
            </Field>
            <Field label="Бухгалтер (подпись)">
              <Input
                value={accountant}
                onChange={(e) => setAccountant(e.target.value)}
                placeholder={ctx.requisites?.accountant || 'из реквизитов'}
              />
            </Field>
            <Field label="Комментарий / примечание">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={doc.note || ''}
              />
            </Field>
            <div className="text-[11.5px] text-muted leading-relaxed pt-1 border-t border-line">
              Изменения здесь — только для этой печати. Реквизиты
              компании (ИНН/КПП/адрес/банк) редактируйте в Настройках.
            </div>
          </div>

          {/* Правая колонка — превью A4 в iframe */}
          <div className="flex-1 bg-surface-2/60 overflow-hidden min-h-[320px]">
            <iframe
              ref={iframeRef}
              title="Предпросмотр печати"
              className="w-full h-full bg-white border-0"
              // sandbox нужен чтобы iframe корректно рендерил html из blob
              sandbox="allow-same-origin"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line bg-surface-2/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <div className="text-[12px] text-muted flex-1">
            «Печать» откроет системный диалог — там можно выбрать «Сохранить
            в PDF».
          </div>
          <Button variant="soft" icon={ExternalLink} onClick={openNewTab}>
            В новой вкладке
          </Button>
          <Button icon={Printer} onClick={doPrint}>
            Печать
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
