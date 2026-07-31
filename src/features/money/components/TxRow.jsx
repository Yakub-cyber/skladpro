import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Printer, Trash2 } from 'lucide-react'
import { Badge, cx } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { money } from '@/shared/lib/format'
import { purposeLabel } from '@/shared/lib/money'

export default function TxRow({ tx, accounts, customers, suppliers, onCancel, onPrint }) {
  const confirm = useConfirm()
  const askCancel = async () => {
    const ok = await confirm({
      title: `Отменить транзакцию ${tx.no}?`,
      body: 'Баланс счёта пересчитается автоматически. Историю запись сохранит со статусом «отменено».',
      tone: 'warning',
      okLabel: 'Отменить транзакцию',
      cancelLabel: 'Оставить',
    })
    if (ok) onCancel()
  }
  const acc = accounts.find((a) => a.id === tx.accountId)
  const toAcc = accounts.find((a) => a.id === tx.toAccountId)
  const cust = customers.find((c) => c.id === tx.customerId)
  const sup = suppliers.find((s) => s.id === tx.supplierId)
  const cancelled = tx.status === 'cancelled'
  const sign = tx.type === 'in' ? '+' : tx.type === 'out' ? '−' : ''
  const Icon =
    tx.type === 'in' ? ArrowDownToLine : tx.type === 'out' ? ArrowUpFromLine : ArrowLeftRight
  const tone = tx.type === 'in' ? 'text-ok' : tx.type === 'out' ? 'text-bad' : 'text-info'

  return (
    <div className={cx('flex items-center gap-3 p-3.5', cancelled && 'opacity-50 line-through')}>
      <div
        className={cx(
          'h-9 w-9 rounded-lg grid place-items-center shrink-0',
          tx.type === 'in' ? 'bg-ok-soft' : tx.type === 'out' ? 'bg-bad-soft' : 'bg-info-soft',
          tone,
        )}
      >
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium flex items-center gap-1.5 flex-wrap">
          <span>{purposeLabel(tx.type, tx.purpose)}</span>
          <Badge tone="brand" className="text-[10px]">{tx.no}</Badge>
          {cancelled && <Badge tone="bad" className="text-[10px]">отменено</Badge>}
        </div>
        <div className="text-[11.5px] text-muted mt-0.5 truncate">
          {tx.type === 'transfer'
            ? `${acc?.name || '—'} → ${toAcc?.name || '—'}`
            : acc?.name || '—'}
          {cust && ` · клиент: ${cust.name}`}
          {sup && ` · поставщик: ${sup.name}`}
          {tx.note && ` · ${tx.note}`}
        </div>
      </div>
      <div className={cx('text-[15px] font-semibold tabular-nums shrink-0', tone)}>
        {sign}
        {money(tx.amount)}
      </div>
      <button onClick={onPrint} className="text-muted hover:text-ink p-1.5" title="Печать (КО-1 / КО-2)">
        <Printer size={14} />
      </button>
      {!cancelled && (
        <button onClick={askCancel} className="text-muted hover:text-bad p-1.5" title="Отменить">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}
