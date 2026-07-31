import { useEffect, useState } from 'react'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { Avatar, Badge, Empty, Section, Select, cx } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'
import { ROLES, roleInfo } from '@/shared/lib/constants'
import { loadMembers, removeMember, updateMemberRole } from '@/shared/lib/cloud'

// Список тех, кто уже зарегистрирован и является членом компании.
// Смена роли и удаление ограничены: нельзя удалить себя, нельзя удалить
// последнего админа; роль меняет только admin.
export default function TeamMembers({ companyId }) {
  const currentEmail = useStore((s) => s.authEmail)
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(null) // { userId, action }
  const [msg, setMsg] = useState(null)
  const confirm = useConfirm()

  const refresh = () => loadMembers().then(setMembers).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const changeRole = async (m, newRole) => {
    if (newRole === m.role) return
    setBusy({ userId: m.user_id, action: 'role' })
    setMsg(null)
    const r = await updateMemberRole(m.user_id, companyId, newRole)
    setBusy(null)
    if (!r?.ok) return setMsg({ ok: false, m: r?.error || 'Не удалось сменить роль' })
    refresh()
  }

  const remove = async (m) => {
    const ok = await confirm({
      title: `Удалить «${m.name || m.email}» из компании?`,
      body: 'Пользователь потеряет доступ к данным компании. Если это последний админ, сервер откажет.',
      tone: 'danger',
      okLabel: 'Удалить участника',
    })
    if (!ok) return
    setBusy({ userId: m.user_id, action: 'remove' })
    setMsg(null)
    const r = await removeMember(m.user_id, companyId)
    setBusy(null)
    if (!r?.ok) return setMsg({ ok: false, m: r?.error || 'Не удалось удалить участника' })
    refresh()
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" /> Участники компании
        </span>
      }
      subtitle="Кто уже присоединился к компании. Роль и удаление доступны только админу."
    >
      {members.length === 0 ? (
        <Empty
          icon={ShieldCheck}
          title="Пока никого"
          text="Как только приглашённый зарегистрируется — он появится здесь."
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const r = roleInfo(m.role)
            const isMe =
              m.email &&
              currentEmail &&
              m.email.toLowerCase() === String(currentEmail).toLowerCase()
            const isBusy = busy?.userId === m.user_id
            return (
              <div
                key={m.user_id || m.email}
                className="flex items-center gap-3 p-3 rounded-xl bg-surface-2"
              >
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                  <Avatar name={m.name || m.email} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">
                    {m.name || m.email}
                    {isMe && <span className="text-[11px] text-muted ml-1.5">(вы)</span>}
                  </div>
                  <div className="text-[12px] text-muted truncate">{m.email}</div>
                </div>
                {isMe ? (
                  <Badge tone="brand">{r.label}</Badge>
                ) : (
                  <Select
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value)}
                    disabled={isBusy}
                    className="w-[130px]"
                  >
                    {ROLES.map((rr) => (
                      <option key={rr.key} value={rr.key}>{rr.label}</option>
                    ))}
                  </Select>
                )}
                {!isMe && (
                  <button
                    onClick={() => remove(m)}
                    disabled={isBusy}
                    className={cx('p-1', isBusy ? 'text-muted' : 'text-muted hover:text-bad')}
                    title="Удалить из компании"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {msg && (
        <Badge tone={msg.ok ? 'ok' : 'bad'} className="mt-3">
          {msg.m}
        </Badge>
      )}
    </Section>
  )
}
