// Маркировка «Честный знак». Приход кодов маркировки (DataMatrix) при
// приёмке; при продаже коды выбывают из оборота. Норма: n(кодов) = stock.
import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import { Card, Button, Badge, Empty } from '../../components/ui'
import ScannerInput from '../../components/ScannerInput'
import { useStore } from '../../store/useStore'
import { num } from '../../lib/format'

export default function MarkingTab() {
  const { products, addMarkCodes } = useStore()
  const marked = products.filter((p) => p.marked)
  const [activeId, setActiveId] = useState(null)
  const [show, setShow] = useState({})

  if (!marked.length) {
    return (
      <Empty
        icon={ShieldCheck}
        title="Нет маркируемых товаров"
        text="Отметьте товар «Честный знак» в карточке товара — он появится здесь."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-info-soft text-info text-[13px]">
        <ShieldCheck size={16} className="shrink-0 mt-0.5" />
        <span>
          Сканируйте коды маркировки (DataMatrix) при приёмке. Коды выбывают из оборота при продаже.
          В норме число кодов = остатку.
        </span>
      </div>
      {marked.map((p) => {
        const n = p.codes?.length || 0
        const diff = p.stock - n
        const ok = diff === 0
        return (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-ok-soft text-ok grid place-items-center shrink-0">
                <ShieldCheck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-[12px] text-muted">{p.sku} · ост. {num(p.stock)} {p.unit}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] text-muted">Кодов КМ</div>
                <div className="font-semibold tabular-nums">{num(n)}</div>
              </div>
              <Badge tone={ok ? 'ok' : 'warn'}>
                {ok ? (
                  <>
                    <Check size={11} /> сходится
                  </>
                ) : (
                  <>
                    <AlertTriangle size={11} /> {diff > 0 ? `не хватает ${diff}` : `излишек ${-diff}`}
                  </>
                )}
              </Badge>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={activeId === p.id ? 'primary' : 'soft'}
                  icon={Plus}
                  onClick={() => setActiveId(activeId === p.id ? null : p.id)}
                >
                  Коды
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={show[p.id] ? EyeOff : Eye}
                  onClick={() => setShow((s) => ({ ...s, [p.id]: !s[p.id] }))}
                />
              </div>
            </div>

            {activeId === p.id && (
              <div className="mt-3 pt-3 border-t border-line animate-fadeUp">
                <ScannerInput
                  placeholder="Сканируйте код маркировки (DataMatrix)…"
                  onScan={(code) => addMarkCodes(p.id, [code])}
                />
              </div>
            )}

            {show[p.id] && n > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="text-[12px] text-muted mb-1.5">Коды в обороте ({n}):</div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {p.codes.slice(0, 50).map((c, i) => (
                    <div key={i} className="text-[11px] font-mono text-muted bg-surface-2 rounded px-2 py-1 truncate">
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
