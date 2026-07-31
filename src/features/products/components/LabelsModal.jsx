import { useState } from 'react'
import { Check, Printer, Tag, Tags } from 'lucide-react'
import { Modal, Button, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'
import { printLabels, printPriceTags } from '@/shared/lib/labels'

function TypeTab2({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-medium transition border',
        active ? 'bg-brand-soft border-brand/30 text-brand' : 'bg-surface-2 border-line text-muted hover:text-ink',
      )}
    >
      <Icon size={16} /> {children}
    </button>
  )
}

export function LabelsModal({ products, onClose }) {
  const [mode, setMode] = useState('labels') // labels | price
  const [sel, setSel] = useState({}) // id -> qty
  const toggle = (id) =>
    setSel((s) => {
      const n = { ...s }
      if (n[id]) delete n[id]
      else n[id] = 1
      return n
    })
  const setQty = (id, q) => setSel((s) => ({ ...s, [id]: Math.max(1, q) }))

  const entries = Object.entries(sel)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id), qty }))
    .filter((e) => e.p)
  const totalLabels = entries.reduce((a, e) => a + e.qty, 0)
  const print = () => (mode === 'labels' ? printLabels(entries) : printPriceTags(entries))

  return (
    <Modal
      open
      onClose={onClose}
      title="Печать"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={Printer} disabled={!entries.length} onClick={print}>
            Печать{totalLabels ? ` (${totalLabels})` : ''}
          </Button>
        </>
      }
    >
      <div className="flex gap-2 mb-4">
        <TypeTab2 active={mode === 'labels'} onClick={() => setMode('labels')} icon={Tags}>
          Этикетки (штрихкод)
        </TypeTab2>
        <TypeTab2 active={mode === 'price'} onClick={() => setMode('price')} icon={Tag}>
          Ценники
        </TypeTab2>
      </div>
      <p className="text-[13px] text-muted mb-3">
        {mode === 'labels'
          ? 'Этикетки со штрихкодом Code128 — сканируются реальным сканером.'
          : 'Ценники для полки: крупная цена, для весовых — «за кг».'}
      </p>
      <div className="space-y-1.5 max-h-[48vh] overflow-y-auto no-scrollbar">
        {products.map((p) => {
          const on = sel[p.id] != null
          return (
            <div
              key={p.id}
              className={cx(
                'flex items-center gap-3 p-2.5 rounded-xl border transition',
                on ? 'border-brand bg-brand-soft' : 'border-line',
              )}
            >
              <button
                onClick={() => toggle(p.id)}
                className={cx(
                  'h-5 w-5 rounded-md grid place-items-center shrink-0 border',
                  on ? 'bg-brand border-brand text-brand-ink' : 'border-line',
                )}
              >
                {on && <Check size={13} />}
              </button>
              <div className="flex-1 min-w-0" onClick={() => toggle(p.id)}>
                <div className="text-sm font-medium truncate cursor-pointer">{p.name}</div>
                <div className="text-[12px] text-muted">
                  {p.sku} · {money(p.price)} · {p.barcode}
                </div>
              </div>
              {on && (
                <input
                  type="number"
                  min="1"
                  value={sel[p.id]}
                  onChange={(e) => setQty(p.id, +e.target.value)}
                  className="w-16 h-9 px-2 rounded-lg bg-surface border border-line text-sm text-center"
                />
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
