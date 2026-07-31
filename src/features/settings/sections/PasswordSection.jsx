import { useState } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { Section, Button, Field, Input, Badge } from '@/shared/ui'
import { changePassword } from '@/shared/lib/cloud'

// Смена пароля от облачного аккаунта. Требует старый пароль (защита от
// «зашёл на девайс — сменил пароль»). После успешной смены все refresh-семьи
// пользователя гасятся сервером — придётся зайти заново на всех устройствах.
export default function PasswordSection({ companyName }) {
  const [oldPass, setOldPass] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async () => {
    if (!oldPass) return setMsg({ ok: false, m: 'Введите текущий пароль' })
    if (pass.length < 8) return setMsg({ ok: false, m: 'Минимум 8 символов' })
    setBusy(true)
    const r = await changePassword(pass, oldPass)
    setBusy(false)
    setMsg(r.ok
      ? { ok: true, m: 'Пароль изменён — придётся войти заново на всех устройствах' }
      : { ok: false, m: r.error })
    if (r.ok) { setPass(''); setOldPass('') }
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <KeyRound size={16} className="text-brand" /> Безопасность · пароль
        </span>
      }
      subtitle={companyName
        ? `Облачный аккаунт · компания «${companyName}»`
        : 'Смена пароля от аккаунта'}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Текущий пароль" className="flex-1 min-w-[180px]">
          <Input type="password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </Field>
        <Field label="Новый пароль" hint="Минимум 8 символов" className="flex-1 min-w-[180px]">
          <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </Field>
        <Button onClick={submit} disabled={busy || !pass || !oldPass}>
          {busy ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </div>
      {msg && (
        <Badge tone={msg.ok ? 'ok' : 'bad'} className="mt-3">
          {msg.ok && <Check size={12} />} {msg.m}
        </Badge>
      )}
    </Section>
  )
}
