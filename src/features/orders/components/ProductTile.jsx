import { Minus, Plus, Trash2, Scale, ShieldCheck, Package } from 'lucide-react'
import { cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'
import { catInfo, priceFor } from '@/shared/lib/constants'
import { num } from '@/shared/lib/format'
import { CAT_ICON } from '@/features/orders/pos'

// Карточка товара в каталоге. Если товар уже в чеке — управляем количеством
// прямо здесь (`[−] N [+]`), не приходится скроллить вниз к чеку. Убирает
// главную боль мобильного UX «выбрал → нужно скроллить чек и там менять qty».
export default function ProductTile({ p, availOf, priceTypeId, row, onAdd, onSetQty, round3 }) {
  const c = catInfo(p.category)
  const Icon = CAT_ICON[c.icon] || Package
  const step = p.weighted ? 0.1 : 1
  const total = row ? row.qty * row.price : 0

  const clickCard = () => !row && onAdd(p)

  return (
    <div
      role={row ? undefined : 'button'}
      onClick={clickCard}
      className={cx(
        'card p-3 text-left transition relative flex flex-col gap-2',
        row ? 'border-brand' : 'hover:border-brand/50 cursor-pointer',
      )}
    >
      <div className="flex items-center gap-2.5">
        {p.image ? (
          <img src={p.image} alt="" className="h-10 w-10 rounded-lg object-cover shrink-0" />
        ) : (
          <div
            className="h-10 w-10 rounded-lg grid place-items-center shrink-0"
            style={{ background: `color-mix(in srgb, ${c.color} 16%, transparent)`, color: c.color }}
          >
            <Icon size={18} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug line-clamp-2 flex items-center gap-1">
            {p.name}
            {p.weighted && <Scale size={11} className="text-info shrink-0" />}
            {p.marked && <ShieldCheck size={11} className="text-ok shrink-0" />}
          </div>
        </div>
      </div>
      {row ? (
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, round3(row.qty - step))
            }}
            className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            value={row.qty}
            min={p.weighted ? '0.001' : '1'}
            step={step}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSetQty(row.productId, Math.max(0, +e.target.value))}
            className="w-14 h-8 px-1 rounded-lg bg-surface border border-line text-sm text-center"
          />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, round3(row.qty + step))
            }}
            className="h-8 w-8 rounded-lg bg-surface-2 grid place-items-center hover:bg-surface-3"
          >
            <Plus size={14} />
          </button>
          <span className="ml-auto text-sm font-semibold tabular-nums">{money(total)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSetQty(row.productId, 0)
            }}
            title="Убрать"
            className="h-8 w-8 rounded-lg text-muted hover:text-bad hover:bg-surface-2 grid place-items-center"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm tabular-nums">
            {money(priceFor(p, priceTypeId))}
            {p.weighted && <span className="text-[10px] text-muted font-normal">/кг</span>}
          </span>
          <span className={cx('text-[11px]', availOf(p) <= 0 ? 'text-bad font-medium' : 'text-muted')}>
            дост. {num(availOf(p))}
          </span>
        </div>
      )}
    </div>
  )
}
