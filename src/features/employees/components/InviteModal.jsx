import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from '@/shared/ui'
import { ROLES } from '@/shared/lib/constants'
import { inviteMember } from '@/shared/lib/cloud'

export default function InviteModal({ open, onClose, companyId }) {
  const [f, setF] = useState({ email: '', name: '', role: 'stock' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [invited, setInvited] = useState(null)
  const [copied, setCopied] = useState(false)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  // Ссылка на регистрацию с преднастроенным email — админ отправляет её
  // сотруднику (WhatsApp/Telegram/email). При переходе Login подхватит
  // ?email=... и подставит его readonly + сразу откроет вкладку
  // «Регистрация», чтобы пользователь не создал случайно новую компанию.
  const buildLink = (email) => {
    const base = window.location.origin + window.location.pathname
    return `${base}#/?email=${encodeURIComponent(email)}`
  }

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Укажите корректный email')
    setBusy(true)
    setErr('')
    const r = await inviteMember(companyId, f.email, f.role, f.name)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setInvited({ email: f.email, link: buildLink(f.email) })
    setF({ email: '', name: '', role: 'stock' })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invited.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setErr('Не удалось скопировать — выделите ссылку вручную')
    }
  }

  const close = () => {
    setInvited(null)
    setCopied(false)
    setErr('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={invited ? 'Приглашение отправлено' : 'Пригласить сотрудника'}
      footer={
        invited ? (
          <Button onClick={close}>Готово</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Отмена</Button>
            <Button onClick={submit} disabled={busy} icon={Send}>
              {busy ? 'Отправляем…' : 'Пригласить'}
            </Button>
          </>
        )
      }
    >
      {invited ? (
        <div className="space-y-4">
          <p className="text-[13px]">
            На <b>{invited.email}</b> отправлено письмо от Supabase — попросите
            сотрудника подтвердить email и зарегистрироваться, ИЛИ отправьте
            ссылку ниже вручную (WhatsApp / Telegram):
          </p>
          <div className="rounded-xl bg-surface-2 p-3">
            <div className="text-[11.5px] text-muted mb-1">Ссылка на регистрацию</div>
            <div className="flex items-center gap-2">
              <Input value={invited.link} readOnly className="text-[12px] font-mono" />
              <Button size="sm" onClick={copy}>
                {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            </div>
            <p className="text-[11.5px] text-muted mt-2 leading-relaxed">
              При переходе по ссылке форма регистрации откроется с уже
              заполненным email — сотрудник не сможет ошибиться и попасть
              в чужую компанию.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-muted">
            Сотрудник зарегистрируется на этом же сайте с указанным email — и сразу окажется в вашей компании с выбранной ролью.
          </p>
          <Field label="Email сотрудника">
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input
                value={f.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="ivan@mail.ru"
                className="pl-9"
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Имя (необязательно)">
              <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Иван" />
            </Field>
            <Field label="Роль">
              <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {err && <div className="text-[13px] text-bad">{err}</div>}
        </div>
      )}
    </Modal>
  )
}
