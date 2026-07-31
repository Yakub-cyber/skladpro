import { useState } from 'react'
import { KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { cx, Button, Field, Input } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'

// Экран ввода нового пароля после перехода по magic-link из письма сброса.
// При успехе сервер гасит все refresh-семьи пользователя (см. auth.ts
// в бэкенде) — придётся войти заново на всех устройствах.
export default function ResetPassword() {
  const completePasswordReset = useStore((s) => s.completePasswordReset)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    if (pass.length < 8) return setErr('Пароль минимум 8 символов')
    if (pass !== pass2) return setErr('Пароли не совпадают')
    setBusy(true)
    setErr('')
    const r = await completePasswordReset(pass)
    if (!r.ok) {
      setErr(r.error || 'Не удалось сменить пароль')
      setBusy(false)
    }
    // при успехе recoveryMode → false, bootstrap покажет приложение
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <KeyRound size={28} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">Новый пароль</div>
          <div className="text-[12px] text-muted mt-1 text-center max-w-xs">
            Придумайте новый пароль для входа в СкладПро.
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 animate-fadeUp">
          <div className="space-y-3">
            <Field label="Новый пароль" hint="Минимум 8 символов">
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" className="pl-9" autoComplete="new-password" autoFocus />
              </div>
            </Field>
            <Field label="Повторите пароль">
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="••••••••" className="pl-9" autoComplete="new-password" />
              </div>
            </Field>
          </div>
          {err && <div className="text-[13px] text-bad mt-3">{err}</div>}
          <Button type="submit" disabled={busy} icon={busy ? Loader2 : ShieldCheck} className={cx('w-full mt-4', busy && '[&>svg]:animate-spin')}>
            {busy ? 'Сохраняем…' : 'Сохранить и войти'}
          </Button>
        </form>
      </div>
    </div>
  )
}
