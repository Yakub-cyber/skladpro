import { Check, Printer, X } from 'lucide-react'
import { Button } from '@/shared/ui'
import { money } from '@/shared/lib/format'

// Тост после пробития чека — кассир остаётся на месте и сразу
// видит подтверждение + может допечатать чек.
export default function ReceiptToast({ receipt, onPrint, onDismiss }) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl bg-ok-soft border border-ok/25 px-4 py-3 animate-fadeUp">
      <Check size={18} className="text-ok shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-ok">
          {receipt.kind === 'retail' ? 'Чек пробит' : 'Заказ оформлен'} · {receipt.no}
        </div>
        <div className="text-[12px] text-muted">
          {money(receipt.total)}
          {receipt.payment?.change > 0 && ` · сдача ${money(receipt.payment.change)}`}
        </div>
      </div>
      <Button
        size="sm"
        variant="soft"
        icon={Printer}
        onClick={onPrint}
      >
        Печать
      </Button>
      <button
        onClick={onDismiss}
        className="text-muted hover:text-ink p-1"
        title="Скрыть"
      >
        <X size={16} />
      </button>
    </div>
  )
}
