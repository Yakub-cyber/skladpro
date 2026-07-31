import {
  Check,
  FileEdit,
  Printer,
  Send,
  Trash2,
  Truck,
  X,
} from 'lucide-react'
import { Badge, Button, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'

export const STATUS_INFO = {
  draft: { label: 'Черновик', tone: 'warn' },
  sent: { label: 'Отправлен', tone: 'info' },
  received: { label: 'Получен', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'brand' },
  cancelled: { label: 'Отменён', tone: 'bad' },
}

const TONE_CLS = {
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  bad: 'bg-bad-soft text-bad',
  brand: 'bg-brand-soft text-brand',
  warn: 'bg-warn-soft text-warn',
}

export default function PORow({ po, onEdit, onSend, onReceive, onCancel, onDelete, onPrint }) {
  const info = STATUS_INFO[po.status] || STATUS_INFO.draft
  const editable = po.status === 'draft'
  const canSend = po.status === 'draft'
  const canReceive = po.status === 'draft' || po.status === 'sent'
  const canCancel = po.status !== 'received' && po.status !== 'cancelled'
  const canDelete = po.status === 'draft' || po.status === 'cancelled'

  return (
    <div className="p-4 flex items-start gap-3 flex-wrap">
      <div className={cx('h-10 w-10 rounded-lg grid place-items-center shrink-0', TONE_CLS[info.tone])}>
        <Truck size={19} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[14px]">{po.no}</span>
          <Badge tone={info.tone} className="text-[10px]">{info.label}</Badge>
          <span className="text-[13px] text-muted truncate">· {po.supplierName || '—'}</span>
        </div>
        <div className="text-[12px] text-muted mt-0.5">
          {po.items?.length || 0} поз. на {money(po.total || 0)}
          {po.expectedAt &&
            ` · ожидается ${new Date(po.expectedAt).toLocaleDateString('ru-RU')}`}
          {po.note && ` · ${po.note}`}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <Button size="sm" variant="soft" icon={Printer} onClick={onPrint}>Печать</Button>
        {editable && (
          <Button size="sm" variant="soft" icon={FileEdit} onClick={onEdit}>Править</Button>
        )}
        {canSend && (
          <Button size="sm" variant="soft" icon={Send} onClick={onSend}>Отправить</Button>
        )}
        {canReceive && (
          <Button size="sm" icon={Check} onClick={onReceive}>Принять товар</Button>
        )}
        {canCancel && (
          <button onClick={onCancel} className="text-muted hover:text-bad p-1.5" title="Отменить">
            <X size={16} />
          </button>
        )}
        {canDelete && (
          <button onClick={onDelete} className="text-muted hover:text-bad p-1.5" title="Удалить">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
