import { useEffect, useState } from 'react'
import { Plus, Sparkles, Loader2, AlertTriangle } from 'lucide-react'
import { Modal, Button, Badge, Field, Textarea, cx } from '@/shared/ui'
import { num } from '@/shared/lib/format'
import { aiParseInvoice, aiConfig, aiEnabled } from '@/shared/lib/ai'
import { useStore } from '@/shared/store/useStore'

// Диалог распознавания накладной. Автоматически использует LLM (если в
// настройках задан ключ) или локальный парсер. Пользователь видит список
// распознанных позиций, снимает флажки с ненужных, жмёт «Добавить в чек».
export default function AiInvoiceModal({ open, onClose, products, onAdd }) {
  const settings = useStore((s) => s.settings) || {}
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState([])
  const [checked, setChecked] = useState({}) // productId → true
  const [err, setErr] = useState('')

  const usingLLM = aiEnabled(settings)

  useEffect(() => {
    if (!open) {
      setText('')
      setItems([])
      setChecked({})
      setErr('')
      setBusy(false)
    }
  }, [open])

  const parse = async () => {
    setErr('')
    if (!text.trim()) return
    setBusy(true)
    try {
      const res = await aiParseInvoice(text, products, aiConfig(settings))
      setItems(res || [])
      // По умолчанию отмечаем все, что удалось сопоставить с каталогом.
      const next = {}
      for (const it of res || []) if (it.productId) next[it.productId] = true
      setChecked(next)
    } catch (e) {
      setErr(e?.message || 'Не удалось разобрать текст.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id) => setChecked((s) => ({ ...s, [id]: !s[id] }))

  const selected = items.filter((it) => it.productId && checked[it.productId])
  const matchedCount = items.filter((it) => it.productId).length
  const missedCount = items.filter((it) => !it.productId).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-brand" /> ИИ-накладная
          <Badge tone={usingLLM ? 'brand' : 'muted'} className="text-[10px]">
            {usingLLM ? 'LLM ProxyAPI' : 'локальный парсер'}
          </Badge>
        </span>
      }
    >
      <div className="space-y-3">
        <Field
          label="Текст накладной"
          hint="Список позиций из мессенджера, письма, наклейки. Одна позиция — одна строка. Пример: «Гвозди 3×70 — 5 кг; Саморез 3.5×40 — 2 упаковки»."
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              'Гвозди 3×70 5 кг\nСаморез по дереву 3.5×40 — 2 уп\nРулетка 5м, 3 шт'
            }
            rows={6}
            autoFocus
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button icon={busy ? Loader2 : Sparkles} onClick={parse} disabled={busy || !text.trim()}>
            {busy ? 'Распознаю…' : 'Распознать'}
          </Button>
          {items.length > 0 && (
            <span className="text-[12.5px] text-muted">
              Найдено {items.length} · сопоставлено {matchedCount}
              {missedCount > 0 && ` · не найдено ${missedCount}`}
            </span>
          )}
        </div>

        {err && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-bad-soft text-bad text-[13px]">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        {items.length > 0 && (
          <div className="border border-line rounded-xl overflow-hidden">
            <div className="max-h-72 overflow-y-auto divide-y divide-line">
              {items.map((it, i) => {
                const matched = !!it.productId
                const on = matched && !!checked[it.productId]
                return (
                  <label
                    key={i}
                    className={cx(
                      'flex items-center gap-3 px-3 py-2 text-[13px] cursor-pointer',
                      matched ? 'hover:bg-surface-2' : 'opacity-70',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand"
                      disabled={!matched}
                      checked={on}
                      onChange={() => matched && toggle(it.productId)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{it.name}</div>
                      {!matched && (
                        <div className="text-[11.5px] text-warn">
                          Не найден в каталоге — добавьте товар вручную или переформулируйте.
                        </div>
                      )}
                      {matched && it.confidence < 100 && (
                        <div className="text-[11px] text-muted">
                          Совпадение {it.confidence}%
                        </div>
                      )}
                    </div>
                    <div className="text-[12px] tabular-nums text-muted">
                      {num(it.qty)} {it.unit}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            icon={Plus}
            className="flex-1"
            disabled={selected.length === 0}
            onClick={() => onAdd(selected)}
          >
            Добавить в чек ({selected.length})
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
