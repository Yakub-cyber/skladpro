import { Check, ShoppingCart } from 'lucide-react'
import { cx } from '@/shared/ui'
import { money, num } from '@/shared/lib/format'

// Mobile: fixed bar снизу + кнопка «Оплатить». На десктопе скрыт.
export default function MobileCartBar({ rows, count, total, onOpen, asOrder }) {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-surface/95 backdrop-blur px-3 py-2 flex items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="relative">
          <ShoppingCart size={20} className="text-brand" />
          {count > 0 && (
            <span className="absolute -top-2 -right-2 h-4 min-w-4 px-1 rounded-full bg-brand text-brand-ink text-[10px] font-bold grid place-items-center">
              {num(count)}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted leading-none">
            {rows.length ? `${rows.length} поз. · ${num(count)}` : 'Чек пуст'}
          </div>
          <div className="text-lg font-semibold tabular-nums leading-tight truncate">
            {money(total)}
          </div>
        </div>
      </div>
      {/* На мобиле CTA-bar внизу: тап открывает bottom-sheet чека,
          там свой большой «Оплатить» откроет PaymentModal. */}
      <button
        onClick={onOpen}
        disabled={!rows.length}
        className={cx(
          'h-12 px-5 rounded-2xl inline-flex items-center gap-2 text-white text-[15px] font-bold transition shrink-0',
          rows.length
            ? 'bg-[var(--ok,#16a34a)] hover:brightness-110'
            : 'bg-surface-3 text-muted cursor-not-allowed',
        )}
      >
        <Check size={18} /> {asOrder ? 'Заказ' : 'Оплатить'}
      </button>
    </div>
  )
}
