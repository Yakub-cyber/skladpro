import { useEffect, useState } from 'react'
import { Clock, Mail, Send, Trash2, UserPlus } from 'lucide-react'
import { Badge, Button, Empty, Section } from '@/shared/ui'
import { roleInfo } from '@/shared/lib/constants'
import { loadInvites, revokeInvite } from '@/shared/lib/cloud'
import { dateFull } from '@/shared/lib/format'
import InviteModal from './InviteModal'

export default function TeamInvites({ companyId }) {
  const [invites, setInvites] = useState([])
  const [open, setOpen] = useState(false)
  const refresh = () => loadInvites().then(setInvites).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <UserPlus size={16} className="text-brand" /> Приглашения в команду
        </span>
      }
      subtitle="Пригласите сотрудника по email — он зарегистрируется и автоматически войдёт в вашу компанию"
      action={
        <Button size="sm" icon={Send} onClick={() => setOpen(true)}>
          Пригласить
        </Button>
      }
    >
      {invites.length === 0 ? (
        <Empty
          icon={Mail}
          title="Нет активных приглашений"
          text="Нажмите «Пригласить», чтобы добавить сотрудника."
        />
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => {
            const r = roleInfo(inv.role)
            return (
              <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-2">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                  <Mail size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{inv.email}</div>
                  <div className="text-[12px] text-muted flex items-center gap-1.5">
                    <Clock size={11} /> Ожидает регистрации · {dateFull(inv.created_at)}
                  </div>
                </div>
                <Badge tone="brand">{r.label}</Badge>
                <button
                  onClick={() => revokeInvite(inv.id).then(refresh)}
                  className="text-muted hover:text-bad p-1"
                  title="Отозвать приглашение"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <InviteModal
        open={open}
        onClose={() => {
          setOpen(false)
          refresh()
        }}
        companyId={companyId}
      />
    </Section>
  )
}
