import { useState } from 'react'
import { ArrowLeft, Boxes, Cloud, KeyRound, Loader2, Mail } from 'lucide-react'
import { cx, Button, Field, Input } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { requestPasswordReset } from '@/shared/lib/cloud'

// Чтение параметра из hash-URL (у нас HashRouter, поэтому query после #/).
// `?invite=xxx&email=y@z` → { invite: 'xxx', email: 'y@z' }.
function readHashParam(key) {
  if (typeof window === 'undefined') return ''
  const h = window.location.hash || ''
  const qi = h.indexOf('?')
  if (qi < 0) return ''
  const params = new URLSearchParams(h.slice(qi + 1))
  return params.get(key) || ''
}

// Облачный вход/регистрация/восстановление пароля. Три режима — переключаются
// табами. При наличии ?invite=<token> в hash-URL режим форсируется на signup
// и email из инвайта нельзя изменить (защита от захвата инвайт-ссылки).
export default function CloudLogin({ onBack, initialMode = 'signin' }) {
  // F3-7: раньше useStore() без селектора → ререндер CloudLogin на каждое
  // изменение state (audit, sync-тик) — заметный лаг при вводе.
  const signIn = useStore((s) => s.signIn)
  const signUp = useStore((s) => s.signUp)
  const inviteToken = readHashParam('invite')
  const inviteEmail = readHashParam('email')
  const [mode, setMode] = useState(inviteToken ? 'signup' : initialMode)
  const [email, setEmail] = useState(inviteEmail)
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    setInfo('')
    if (mode === 'forgot') {
      if (!email) return setErr('Введите email')
      setBusy(true)
      setErr('')
      const r = await requestPasswordReset(email)
      setBusy(false)
      if (r.ok) setInfo(`Ссылка для сброса пароля отправлена на ${email}. Проверьте почту.`)
      else setErr(r.error)
      return
    }
    if (!email || !pass) return setErr('Заполните email и пароль')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr('Введите корректный email')
    if (mode === 'signup' && pass.length < 8) return setErr('Пароль должен быть не менее 8 символов')
    setBusy(true)
    setErr('')
    const r =
      mode === 'signin'
        ? await signIn(email, pass)
        : await signUp(email, pass, name, inviteToken || null)
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
    } else if (r.needConfirm) {
      setInfo(`Аккаунт создан. На ${email} отправлено письмо с подтверждением — перейдите по ссылке в письме и войдите.`)
      setMode('signin')
      setBusy(false)
    }
    // при успехе bootstrapCloud сменит authUserId → AuthGate покажет приложение
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-4">
            <ArrowLeft size={15} /> На главную
          </button>
        )}
        <div className="flex flex-col items-center mb-7">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <Boxes size={30} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
          <div className="text-[12px] text-muted mt-1 flex items-center gap-1.5">
            <Cloud size={13} /> Облачный режим
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 animate-fadeUp">
          {mode !== 'forgot' && (
            <div className="flex gap-1 bg-surface-2 rounded-xl p-1 mb-4">
              <button
                type="button"
                onClick={() => { setMode('signin'); setErr(''); setInfo('') }}
                className={cx('flex-1 h-9 rounded-lg text-[13px] font-medium', mode === 'signin' ? 'bg-brand text-brand-ink' : 'text-muted')}
              >
                Вход
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setErr(''); setInfo('') }}
                className={cx('flex-1 h-9 rounded-lg text-[13px] font-medium', mode === 'signup' ? 'bg-brand text-brand-ink' : 'text-muted')}
              >
                Регистрация
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <div className="font-semibold mb-3">Восстановление пароля</div>
          )}

          <div className="space-y-3">
            {mode === 'signup' && (
              <Field label="Имя">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" />
              </Field>
            )}
            <Field label="Email" hint={inviteEmail && mode === 'signup' ? 'Email из приглашения — изменить нельзя' : undefined}>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mail@example.ru"
                  className="pl-9"
                  autoComplete="email"
                  readOnly={!!(inviteEmail && mode === 'signup')}
                />
              </div>
            </Field>
            {inviteToken && mode === 'signup' && (
              <div className="text-[12px] text-info bg-info-soft/50 rounded-lg px-3 py-2">
                Вы принимаете приглашение в существующую компанию — своя компания создаваться не будет, вы сразу станете её сотрудником.
              </div>
            )}
            {mode !== 'forgot' && (
              <Field label="Пароль" hint={mode === 'signup' ? 'Минимум 8 символов' : undefined}>
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" className="pl-9" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
                </div>
              </Field>
            )}
          </div>

          {err && <div className="text-[13px] text-bad mt-3">{err}</div>}
          {info && <div className="text-[13px] text-ok mt-3">{info}</div>}

          <Button type="submit" disabled={busy} icon={busy ? Loader2 : undefined} className={cx('w-full mt-4', busy && '[&>svg]:animate-spin')}>
            {busy ? 'Подождите…' : mode === 'signin' ? 'Войти' : mode === 'signup' ? 'Создать аккаунт' : 'Отправить ссылку'}
          </Button>

          {mode === 'signin' && (
            <button type="button" onClick={() => { setMode('forgot'); setErr(''); setInfo('') }} className="w-full mt-3 text-[12px] text-muted hover:text-brand text-center">
              Забыли пароль?
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" onClick={() => { setMode('signin'); setErr(''); setInfo('') }} className="w-full mt-3 text-[12px] text-muted hover:text-ink text-center">
              ← Назад ко входу
            </button>
          )}
          {mode === 'signup' && (
            <p className="text-[12px] text-muted mt-3 text-center">
              Первый зарегистрированный — администратор. Остальных приглашайте в разделе «Сотрудники».
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
