import { useEffect, useState } from 'react'
import { Boxes, Delete, ArrowLeft, Lock, ShieldCheck, Mail, KeyRound, Loader2, Cloud, Building2, LogOut } from 'lucide-react'
import { Avatar, cx, Button, Field, Input } from '../components/ui'
import { useStore } from '../store/useStore'
import { roleInfo } from '../lib/constants'
import { requestPasswordReset } from '../lib/cloud'
import Landing from './Landing'
import Connect from './Connect'

export default function Login() {
  const cloud = useStore((s) => s.cloud)
  const [showAuth, setShowAuth] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  if (!cloud) return <PinLogin />
  if (showAuth) return <CloudLogin onBack={() => setShowAuth(false)} />
  if (showConnect)
    return <Connect onStart={() => setShowAuth(true)} onBack={() => setShowConnect(false)} />
  return <Landing onStart={() => setShowAuth(true)} onConnect={() => setShowConnect(true)} />
}

// Онбординг: вошёл, но компании ещё нет → создаём (тенант)
export function Onboarding() {
  const createCompany = useStore((s) => s.createCompany)
  const cloudLogout = useStore((s) => s.cloudLogout)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!name.trim()) return setErr('Введите название компании')
    setBusy(true)
    setErr('')
    const r = await createCompany(name.trim())
    if (!r.ok) {
      setErr(r.error)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <Building2 size={28} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">Создайте компанию</div>
          <div className="text-[12px] text-muted mt-1 text-center max-w-xs">
            Это ваше рабочее пространство — данные будут видны только вашим сотрудникам.
          </div>
        </div>

        <form onSubmit={submit} className="card p-5 animate-fadeUp">
          <Field label="Название компании">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. «СтройОпт» или ИП Иванов"
              autoFocus
            />
          </Field>
          {err && <div className="text-[13px] text-bad mt-3">{err}</div>}
          <Button type="submit" disabled={busy} icon={busy ? Loader2 : Building2} className={cx('w-full mt-4', busy && '[&>svg]:animate-spin')}>
            {busy ? 'Создаём…' : 'Создать и начать'}
          </Button>
          <button
            type="button"
            onClick={cloudLogout}
            className="w-full mt-2 h-9 flex items-center justify-center gap-2 text-[13px] text-muted hover:text-ink"
          >
            <LogOut size={14} /> Выйти
          </button>
        </form>
      </div>
    </div>
  )
}

// Экран ввода нового пароля после перехода по ссылке из письма сброса
export function ResetPassword() {
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

function PinLogin() {
  const employees = (useStore((s) => s.employees) || []).filter((e) => e.active)
  const login = useStore((s) => s.login)
  const [sel, setSel] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)

  const me = employees.find((e) => e.id === sel)

  // авто-проверка при вводе 4 цифр (login асинхронный: хэшируем PIN)
  useEffect(() => {
    if (!(sel && pin.length === 4)) return
    let cancelled = false
    ;(async () => {
      const res = await login(sel, pin)
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        setShake(true)
        setTimeout(() => {
          setPin('')
          setShake(false)
        }, 500)
      }
      // при успехе AuthGate сам отрисует приложение
    })()
    return () => {
      cancelled = true
    }
  }, [pin, sel, login])

  const press = (d) => {
    setError('')
    setPin((p) => (p.length < 4 ? p + d : p))
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg p-5">
      <div className="w-full max-w-sm">
        {/* Лого */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30 mb-3">
            <Boxes size={30} strokeWidth={2.2} />
          </div>
          <div className="text-xl font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
          <div className="text-[12px] text-muted mt-1">Вход в систему</div>
        </div>

        {!sel ? (
          /* Выбор сотрудника */
          <div className="card p-4 animate-fadeUp">
            <div className="text-[13px] text-muted mb-3 px-1">Выберите сотрудника</div>
            <div className="space-y-2">
              {employees.map((e) => {
                const r = roleInfo(e.role)
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      setSel(e.id)
                      setPin('')
                      setError('')
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-line hover:border-brand/50 hover:bg-surface-2 transition text-left"
                  >
                    <Avatar name={e.name} color={r.color} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{e.name}</div>
                      <div className="text-[12px] text-muted">{r.label}</div>
                    </div>
                    <Lock size={15} className="text-muted" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          /* Ввод PIN */
          <div className={cx('card p-5 animate-fadeUp', shake && 'animate-shake')}>
            <button
              onClick={() => {
                setSel(null)
                setPin('')
                setError('')
              }}
              className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-4"
            >
              <ArrowLeft size={15} /> Сменить сотрудника
            </button>

            <div className="flex flex-col items-center mb-5">
              <Avatar name={me.name} color={roleInfo(me.role).color} size={52} />
              <div className="font-medium mt-2">{me.name}</div>
              <div className="text-[12px] text-muted">{roleInfo(me.role).label}</div>
            </div>

            {/* индикатор PIN */}
            <div className="flex justify-center gap-3 mb-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={cx(
                    'w-3.5 h-3.5 rounded-full border-2 transition',
                    i < pin.length
                      ? 'bg-brand border-brand'
                      : error
                        ? 'border-bad'
                        : 'border-line',
                  )}
                />
              ))}
            </div>
            <div className="h-5 text-center text-[12px] text-bad mb-2">{error}</div>

            {/* клавиатура */}
            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <PadBtn key={n} onClick={() => press(String(n))}>
                  {n}
                </PadBtn>
              ))}
              <div />
              <PadBtn onClick={() => press('0')}>0</PadBtn>
              <PadBtn onClick={() => setPin((p) => p.slice(0, -1))} className="text-muted">
                <Delete size={20} />
              </PadBtn>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck size={13} /> Демо-PIN: 1111 · 2222 · 3333 · 4444
        </div>
      </div>
    </div>
  )
}

function PadBtn({ children, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'h-14 rounded-xl bg-surface-2 hover:bg-surface-3 active:scale-95 text-xl font-medium grid place-items-center transition',
        className,
      )}
    >
      {children}
    </button>
  )
}

function CloudLogin({ onBack }) {
  const { signIn, signUp } = useStore()
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
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
    setBusy(true)
    setErr('')
    const r =
      mode === 'signin'
        ? await signIn(email, pass)
        : await signUp(email, pass, name)
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
            <Field label="Email">
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mail@example.ru" className="pl-9" autoComplete="email" />
              </div>
            </Field>
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
